import { swapConfig, getPriorityFeeCap, SpeedMode } from "./config";
import type { BuildResult } from "./types";

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
  
  try {
    const endpoint = side === "buy" 
      ? `${swapConfig.pumpPortalBaseUrl}/api/trade-local`
      : `${swapConfig.pumpPortalBaseUrl}/api/trade-local`;
    
    // PumpPortal trade-local API:
    //   - For buys: denominatedInSol="true", amount = SOL amount (e.g. 0.1)
    //   - For sells: denominatedInSol="false", amount = token UI amount (e.g. 123.45)
    //   - slippage: percentage value (e.g. 25 = 25%)
    //   - priorityFee: SOL amount (e.g. 0.001)
    const body: any = {
      publicKey: userPublicKey,
      action: side,
      mint,
      denominatedInSol: side === "buy" ? "true" : "false",
      amount: side === "buy" ? amountSol : amountTokens,
      slippage: slippageBps / 100, // bps to percent: 200 bps → 2 (2%)
      priorityFee: priorityFeeCap / 1_000_000_000,
      pool: "auto",
    };

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
      console.error("[Pump] Build error:", response.status, errorText);
      console.error("[Pump] Request body was:", JSON.stringify(body));
      
      // 400 error typically means token is graduated (no longer on bonding curve)
      const isGraduated = response.status === 400;
      
      return {
        ok: false,
        code: isGraduated ? "TOKEN_GRADUATED" : "PUMP_UNAVAILABLE",
        message: isGraduated 
          ? "Token has graduated from bonding curve. Try using Jupiter instead."
          : `Pump API error: ${response.status}`,
        details: errorText,
        isGraduated,
      };
    }
    
    const data = await response.arrayBuffer();

    // Validate response is actual transaction bytes (not JSON error)
    if (data.byteLength < 100) {
      console.error("[Pump] Response too small to be a valid transaction:", data.byteLength, "bytes");
      return {
        ok: false,
        code: "PUMP_UNAVAILABLE",
        message: "Pump API returned invalid transaction data",
      };
    }

    const base64 = Buffer.from(data).toString("base64");

    return {
      ok: true,
      route: "pump",
      swapTransactionBase64: base64,
      prioritizationFeeLamports: priorityFeeCap,
    };
  } catch (err: any) {
    console.error("[Pump] Build failed:", err);
    
    if (err.name === "AbortError") {
      return {
        ok: false,
        code: "PUMP_UNAVAILABLE",
        message: "Pump API request timed out",
      };
    }
    
    return {
      ok: false,
      code: "PUMP_UNAVAILABLE",
      message: err.message || "Failed to build pump transaction",
    };
  }
}

export function isPumpToken(mint: string): boolean {
  return mint.toLowerCase().endsWith("pump");
}
