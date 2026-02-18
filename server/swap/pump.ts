import { swapConfig, getPriorityFeeCap, SpeedMode } from "./config";
import type { BuildResult } from "./types";

// Keywords in PumpPortal error text that confirm the token has graduated
const GRADUATED_KEYWORDS = [
  "bonding curve complete",
  "graduated",
  "migration",
  "raydium",
  "no longer on bonding curve",
];

function looksLikeGraduationError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return GRADUATED_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Build a pump.fun bonding-curve transaction via PumpPortal.
 *
 * For new/unindexed tokens the detection API may return isPump:false even
 * though the token IS on the bonding curve. In that case PumpPortal's
 * trade-local endpoint may return 400 with pool:"pump". We retry once
 * with pool:"auto" which lets PumpPortal auto-detect the curve on-chain.
 */
export async function buildPumpTransaction(params: {
  userPublicKey: string;
  mint: string;
  side: "buy" | "sell";
  amountSol?: number;
  amountTokens?: number;
  slippageBps: number;
  speedMode: SpeedMode;
  maxPriorityFeeLamports?: number;
}): Promise<BuildResult> {
  const {
    userPublicKey,
    mint,
    side,
    amountSol,
    amountTokens,
    slippageBps,
    speedMode,
    maxPriorityFeeLamports
  } = params;

  if (!swapConfig.pumpModeEnabled) {
    return {
      ok: false,
      code: "PUMP_UNAVAILABLE",
      message: "Pump trading is disabled",
    };
  }

  const priorityFeeCap = getPriorityFeeCap(speedMode, maxPriorityFeeLamports);

  console.log("[Pump] Build request:", { userPublicKey, mint, side, amountSol, amountTokens, speedMode });

  // Try pool:"pump" first (explicit bonding curve), then fall back to
  // pool:"auto" if that fails — covers new tokens not yet indexed.
  const poolsToTry: string[] = ["pump", "auto"];

  for (const pool of poolsToTry) {
    const result = await tryBuildPump({
      userPublicKey,
      mint,
      side,
      amountSol,
      amountTokens,
      slippageBps,
      priorityFeeCap,
      pool,
    });

    if (result.ok) return result;

    // If the error clearly indicates graduation, don't retry with "auto"
    // — let the caller fall through to Jupiter.
    if ((result as any).code === "TOKEN_GRADUATED") return result;

    // For non-graduated errors with pool:"pump", retry with "auto"
    if (pool === "pump") {
      console.log(`[Pump] pool:"pump" failed (${(result as any).code}), retrying with pool:"auto"`);
    }
  }

  // Both pools failed — return a clear error (not TOKEN_GRADUATED)
  return {
    ok: false,
    code: "PUMP_BUILD_FAILED",
    message: "PumpPortal could not build transaction for this token",
  };
}

async function tryBuildPump(params: {
  userPublicKey: string;
  mint: string;
  side: "buy" | "sell";
  amountSol?: number;
  amountTokens?: number;
  slippageBps: number;
  priorityFeeCap: number;
  pool: string;
}): Promise<BuildResult> {
  const {
    userPublicKey,
    mint,
    side,
    amountSol,
    amountTokens,
    slippageBps,
    priorityFeeCap,
    pool,
  } = params;

  try {
    const endpoint = `${swapConfig.pumpPortalBaseUrl}/api/trade-local`;

    // PumpPortal trade-local API:
    //   - For buys: denominatedInSol="true", amount = SOL amount (e.g. 0.1)
    //   - For sells: denominatedInSol="false", amount = token amount (UI units)
    //   - slippage: percentage value (e.g. 25 = 25%)
    //   - priorityFee: SOL amount (e.g. 0.001)
    //   - pool: "pump" for bonding curve, "auto" for auto-detect
    const sellAmount = side === "sell" ? amountTokens : undefined;
    const body: any = {
      publicKey: userPublicKey,
      action: side,
      mint,
      denominatedInSol: side === "buy" ? "true" : "false",
      amount: side === "buy" ? amountSol : sellAmount,
      slippage: slippageBps / 100, // bps to percent: 200 bps → 2 (2%)
      priorityFee: priorityFeeCap / 1_000_000_000,
      pool,
    };

    console.log("[Pump] Sending to PumpPortal:", {
      action: side,
      mint: mint.slice(0, 8),
      amount: body.amount,
      denominatedInSol: body.denominatedInSol,
      pool,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (swapConfig.pumpPortalApiKey) {
      headers["Authorization"] = `Bearer ${swapConfig.pumpPortalApiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Pump] Build error (pool=${pool}):`, response.status, errorText);
      console.error("[Pump] Request body was:", JSON.stringify(body));

      // Only classify as graduated if the error text actually says so
      if (response.status === 400 && looksLikeGraduationError(errorText)) {
        return {
          ok: false,
          code: "TOKEN_GRADUATED",
          message: "Token has graduated from bonding curve. Try using Jupiter instead.",
          details: errorText,
          isGraduated: true,
        };
      }

      return {
        ok: false,
        code: "PUMP_BUILD_FAILED",
        message: `Pump API error (pool=${pool}): ${response.status} — ${errorText.slice(0, 200)}`,
        details: errorText,
      };
    }

    const data = await response.arrayBuffer();

    // Validate response is actual transaction bytes (not JSON error)
    if (data.byteLength < 100) {
      console.error("[Pump] Response too small to be a valid transaction:", data.byteLength, "bytes");
      return {
        ok: false,
        code: "PUMP_BUILD_FAILED",
        message: "Pump API returned invalid transaction data",
      };
    }

    const base64 = Buffer.from(data).toString("base64");

    console.log(`[Pump] Build OK (pool=${pool}), tx size: ${data.byteLength} bytes`);

    return {
      ok: true,
      route: "pump",
      swapTransactionBase64: base64,
      prioritizationFeeLamports: priorityFeeCap,
    };
  } catch (err: any) {
    console.error(`[Pump] Build failed (pool=${pool}):`, err);

    if (err.name === "AbortError") {
      return {
        ok: false,
        code: "PUMP_UNAVAILABLE",
        message: "Pump API request timed out",
      };
    }

    return {
      ok: false,
      code: "PUMP_BUILD_FAILED",
      message: err.message || "Failed to build pump transaction",
    };
  }
}

export function isPumpToken(mint: string): boolean {
  return mint.toLowerCase().endsWith("pump");
}
