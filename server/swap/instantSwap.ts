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

import { Connection } from "@solana/web3.js";
import { getQuote, buildSwapTransaction } from "./jupiter";
import { buildPumpTransaction } from "./pump";
import { getRouteQuote } from "./route";
import { swapConfig, type SpeedMode } from "./config";
import { getToken } from "./tokenlist";
import type { InstantBuildResult } from "./types";

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
