/**
 * Instant Swap — TG-bot-style single round-trip swap
 *
 * Combines route detection + quote + tx build into ONE server call.
 * Client gets back an unsigned transaction ready to sign + send.
 *
 * NOTE: We do NOT modify the transaction bytes returned by Jupiter/PumpPortal.
 * Deserializing → modifying → re-serializing versioned transactions can corrupt
 * the bytes, causing "Invalid transaction: verification failed" from Jito and
 * silent rejection by validators. Jupiter's blockhash is fresh enough.
 */

import { Connection, VersionedTransaction } from "@solana/web3.js";
import { getQuote, buildSwapTransaction } from "./jupiter";
import { buildPumpTransaction } from "./pump";
import { getRouteQuote } from "./route";
import { swapConfig, type SpeedMode } from "./config";
import { getToken } from "./tokenlist";
import { pumpDetectionCache } from "./cache";
import type { InstantBuildResult } from "./types";

// Pump.fun program errors that indicate the bonding curve tx won't work
// and we should fall back to Jupiter (token may have graduated, or curve state is stale)
const PUMP_FALLBACK_ERRORS = new Set([
  6005, // BondingCurveComplete — token graduated, curve is done
  6021, // NotEnoughTokensToBuy — curve reserves exhausted
  6023, // NotEnoughTokensToSell — user balance mismatch / stale tx
  6004, // MintDoesNotMatchBondingCurve — wrong curve account
]);

/**
 * Extract Anchor custom error code from a simulation error object.
 * Simulation errors look like: { InstructionError: [3, { Custom: 6023 }] }
 */
function extractCustomErrorCode(err: any): number | null {
  try {
    if (err?.InstructionError) {
      const detail = err.InstructionError[1];
      if (typeof detail === "object" && detail.Custom !== undefined) {
        return detail.Custom;
      }
    }
  } catch {}
  return null;
}

const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Get lastValidBlockHeight from our RPC (for Pump txs that don't return it).
 * Does NOT modify the transaction.
 */
async function getLastValidBlockHeight(): Promise<number> {
  const connection = new Connection(swapConfig.solanaRpcUrl, { commitment: "confirmed" });
  const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  return lastValidBlockHeight;
}

export async function instantBuild(params: {
  userPublicKey: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  inputTokenDecimals?: number;
  slippageBps: number;
  speedMode: SpeedMode;
  maxPriorityFeeLamports?: number;
}): Promise<InstantBuildResult> {
  const {
    userPublicKey,
    inputMint,
    outputMint,
    amount,
    inputTokenDecimals,
    slippageBps,
    speedMode,
    maxPriorityFeeLamports,
  } = params;
  const start = Date.now();

  // ── Step 1: Detect route (pump vs jupiter) + get quote in one shot ──
  const routeResult = await getRouteQuote({ inputMint, outputMint, amount, slippageBps });

  if (!routeResult.ok) {
    return {
      ok: false,
      code: routeResult.reason || "NO_ROUTE",
      message: routeResult.message || "No route found for this swap",
    };
  }

  const route = routeResult.route;

  // ── Step 2: Build transaction based on route ──
  if (route === "pump" && routeResult.pumpMeta) {
    const isBuying = inputMint === SOL_MINT;
    const pumpMint = isBuying ? outputMint : inputMint;

    // For pump: amount is in lamports for buys. Convert to SOL.
    const amountSol = isBuying ? parseInt(amount) / 1_000_000_000 : undefined;
    // For sells: Pump expects UI token amount (not base units).
    let amountTokens: number | undefined;
    if (!isBuying) {
      const token = await getToken(inputMint);
      // Prefer client-provided decimals from the selected token row.
      // This avoids tiny sells when server token metadata is stale/missing.
      const decimals = inputTokenDecimals ?? token?.decimals ?? 9;
      amountTokens = Number(amount) / Math.pow(10, decimals);
    }

    const buildResult = await buildPumpTransaction({
      userPublicKey,
      mint: pumpMint,
      side: isBuying ? "buy" : "sell",
      amountSol,
      amountTokens,
      slippageBps,
      speedMode,
      maxPriorityFeeLamports,
    });

    if (!buildResult.ok || !buildResult.swapTransactionBase64) {
      // If graduated, fall through to Jupiter
      if ((buildResult as any).code === "TOKEN_GRADUATED") {
        console.log("[InstantBuild] Pump token graduated, falling back to Jupiter");
        return await buildViaJupiter(params, routeResult);
      }
      return {
        ok: false,
        code: (buildResult as any).code || "BUILD_FAILED",
        message: (buildResult as any).message || "Failed to build pump transaction",
      };
    }

    // Simulate the pump transaction to catch invalid/no-op transactions
    // before sending to the client (pump txs are sent with skipPreflight=true)
    try {
      const simConnection = new Connection(swapConfig.solanaRpcUrl, { commitment: "confirmed" });
      const txBytes = Buffer.from(buildResult.swapTransactionBase64, "base64");
      const tx = VersionedTransaction.deserialize(txBytes);

      const simulation = await simConnection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });

      if (simulation.value.err) {
        console.error("[InstantBuild] Pump simulation FAILED:", JSON.stringify(simulation.value.err));
        console.error("[InstantBuild] Logs:", simulation.value.logs?.slice(-5));

        const customCode = extractCustomErrorCode(simulation.value.err);

        // If this is a known bonding-curve error, the token may have graduated
        // or the curve state is stale. Clear detection cache and fall back to Jupiter.
        if (customCode !== null && PUMP_FALLBACK_ERRORS.has(customCode)) {
          console.log(`[InstantBuild] Pump error ${customCode} — clearing cache and falling back to Jupiter`);
          pumpDetectionCache.delete(`pump:${isBuying ? outputMint : inputMint}`);
          return await buildViaJupiter(params, routeResult);
        }

        // For other simulation errors (slippage, etc.) return the failure directly
        return {
          ok: false,
          code: "SIMULATION_FAILED",
          message: `Swap would fail on-chain: ${JSON.stringify(simulation.value.err)}`,
        };
      }

      console.log("[InstantBuild] Pump simulation OK, units:", simulation.value.unitsConsumed);
    } catch (simErr: any) {
      // Don't hard-fail on simulation errors (RPC might be slow)
      // but log it so we can debug
      console.warn("[InstantBuild] Pump simulation error (non-fatal):", simErr.message);
    }

    // Get lastValidBlockHeight from our RPC (Pump doesn't return it)
    const lastValidBlockHeight = await getLastValidBlockHeight();

    const elapsed = Date.now() - start;
    console.log(`[InstantBuild] Pump build done in ${elapsed}ms`);

    return {
      ok: true,
      route: "pump",
      swapTransactionBase64: buildResult.swapTransactionBase64,
      quote: {
        inAmount: amount,
        outAmount: "0", // Pump doesn't give exact output
        minOut: "0",
        priceImpactPct: 0,
        routeLabel: "Pump.fun",
      },
      prioritizationFeeLamports: buildResult.prioritizationFeeLamports || 0,
      lastValidBlockHeight,
    };
  }

  // ── Jupiter route ──
  return await buildViaJupiter(params, routeResult);
}

async function buildViaJupiter(
  params: {
    userPublicKey: string;
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
    speedMode: SpeedMode;
    maxPriorityFeeLamports?: number;
  },
  routeResult: any
): Promise<InstantBuildResult> {
  const {
    userPublicKey,
    inputMint,
    outputMint,
    amount,
    slippageBps,
    speedMode,
    maxPriorityFeeLamports,
  } = params;
  const start = Date.now();

  // If we already have a quote from route detection, use it
  // Otherwise fetch a fresh one
  let jupiterQuote = routeResult.quoteResponse;
  let normalized = routeResult.normalized;

  if (!jupiterQuote) {
    const quoteResult = await getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
      swapMode: "ExactIn",
    });

    if (!quoteResult.ok) {
      return {
        ok: false,
        code: (quoteResult as any).code || "NO_ROUTE",
        message: (quoteResult as any).message || "Failed to get quote",
      };
    }

    jupiterQuote = quoteResult.quote;
    normalized = quoteResult.normalized;
  }

  // Build the swap transaction (pass feeAccount from route detection if available)
  const buildResult = await buildSwapTransaction({
    userPublicKey,
    quote: jupiterQuote,
    speedMode,
    wrapAndUnwrapSol: true,
    maxPriorityFeeLamports,
    feeAccount: routeResult.feeAccount,
  });

  if (!buildResult.ok || !buildResult.swapTransactionBase64) {
    return {
      ok: false,
      code: (buildResult as any).code || "BUILD_FAILED",
      message: (buildResult as any).message || "Failed to build swap transaction",
      details: (buildResult as any).details,
    };
  }

  const routeLabel = jupiterQuote?.routePlan
    ?.map((r: any) => r.swapInfo?.label || r.label)
    .filter(Boolean)
    .slice(0, 2)
    .join(" → ") || "Jupiter";

  const elapsed = Date.now() - start;
  console.log(`[InstantBuild] Jupiter build done in ${elapsed}ms`);

  return {
    ok: true,
    route: "jupiter",
    swapTransactionBase64: buildResult.swapTransactionBase64!,
    quote: {
      inAmount: jupiterQuote.inAmount || amount,
      outAmount: normalized?.outAmount || jupiterQuote.outAmount || "0",
      minOut: normalized?.minOut || jupiterQuote.otherAmountThreshold || "0",
      priceImpactPct: normalized?.priceImpactPct || parseFloat(jupiterQuote.priceImpactPct || "0"),
      routeLabel,
    },
    prioritizationFeeLamports: buildResult.prioritizationFeeLamports || 0,
    lastValidBlockHeight: buildResult.lastValidBlockHeight || 0,
  };
}
