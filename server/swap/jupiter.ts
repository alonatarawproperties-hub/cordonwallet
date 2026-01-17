import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { swapConfig, getPriorityFeeCap, SpeedMode, CORDON_TREASURY_WALLET, CORDON_SUCCESS_FEE_BPS } from "./config";
import type { QuoteResult, BuildResult } from "./types";

export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  swapMode: string;
}): Promise<QuoteResult> {
  const { inputMint, outputMint, amount, slippageBps, swapMode } = params;
  
  const queryParams = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: slippageBps.toString(),
    swapMode,
  });
  
  const url = `${swapConfig.jupiterBaseUrl}${swapConfig.jupiterQuotePath}?${queryParams.toString()}`;
  console.log("[Jupiter] Quote request:", url);
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), swapConfig.jupiterTimeoutMs);
  
  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Cordon-Wallet/1.0",
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    const responseText = await response.text();
    
    if (!response.ok) {
      console.error("[Jupiter] Quote error:", response.status, responseText);
      
      if (responseText.toLowerCase().includes("no route") || 
          responseText.toLowerCase().includes("no routes found")) {
        return {
          ok: false,
          code: "NO_ROUTE",
          message: "No route found for this swap pair",
          details: responseText,
        };
      }
      
      return {
        ok: false,
        code: "UPSTREAM",
        message: `Jupiter API error: ${response.status}`,
        details: responseText,
      };
    }
    
    let quote: any;
    try {
      quote = JSON.parse(responseText);
    } catch {
      return {
        ok: false,
        code: "UPSTREAM",
        message: "Invalid JSON response from Jupiter",
        details: responseText,
      };
    }
    
    if (quote.error) {
      if (quote.error.toLowerCase().includes("no route")) {
        return {
          ok: false,
          code: "NO_ROUTE",
          message: "No route found for this swap pair",
          details: quote,
        };
      }
      
      return {
        ok: false,
        code: "UPSTREAM",
        message: quote.error,
        details: quote,
      };
    }
    
    return {
      ok: true,
      route: "jupiter",
      quote,
      normalized: {
        outAmount: quote.outAmount || "0",
        minOut: quote.otherAmountThreshold || quote.outAmount || "0",
        priceImpactPct: parseFloat(quote.priceImpactPct || "0"),
        routePlan: quote.routePlan || [],
      },
    };
  } catch (err: any) {
    clearTimeout(timeout);
    
    if (err.name === "AbortError") {
      return {
        ok: false,
        code: "TIMEOUT",
        message: "Jupiter quote request timed out",
      };
    }
    
    console.error("[Jupiter] Quote failed:", err);
    return {
      ok: false,
      code: "UPSTREAM",
      message: err.message || "Failed to fetch quote",
    };
  }
}

async function getTreasuryFeeAccount(outputMint: string): Promise<{ feeAccount: string | null; feeBps: number }> {
  try {
    const treasuryPubkey = new PublicKey(CORDON_TREASURY_WALLET);
    const mintPubkey = new PublicKey(outputMint);
    
    const treasuryAta = await getAssociatedTokenAddress(mintPubkey, treasuryPubkey);
    
    const connection = new Connection(swapConfig.solanaRpcUrl);
    const accountInfo = await connection.getAccountInfo(treasuryAta);
    
    if (accountInfo) {
      console.log(`[SwapFee] Treasury ATA exists for mint ${outputMint.slice(0, 8)}..., applying ${CORDON_SUCCESS_FEE_BPS}bps fee`);
      return { feeAccount: treasuryAta.toBase58(), feeBps: CORDON_SUCCESS_FEE_BPS };
    } else {
      console.log(`[SwapFee] Treasury ATA missing for mint ${outputMint.slice(0, 8)}... Fee waived.`);
      return { feeAccount: null, feeBps: 0 };
    }
  } catch (err: any) {
    console.warn(`[SwapFee] Error checking treasury ATA for ${outputMint}: ${err.message}. Fee waived.`);
    return { feeAccount: null, feeBps: 0 };
  }
}

export async function buildSwapTransaction(params: {
  userPublicKey: string;
  quote: any;
  speedMode: SpeedMode;
  maxPriorityFeeLamports?: number;
  wrapAndUnwrapSol: boolean;
}): Promise<BuildResult> {
  const { userPublicKey, quote, speedMode, maxPriorityFeeLamports, wrapAndUnwrapSol } = params;
  
  const priorityFeeCap = getPriorityFeeCap(speedMode, maxPriorityFeeLamports);
  
  const outputMint = quote?.outputMint;
  let feeAccount: string | null = null;
  let feeBps = 0;
  
  if (outputMint) {
    const feeInfo = await getTreasuryFeeAccount(outputMint);
    feeAccount = feeInfo.feeAccount;
    feeBps = feeInfo.feeBps;
  }
  
  const url = `${swapConfig.jupiterBaseUrl}${swapConfig.jupiterSwapPath}`;
  console.log("[Jupiter] Build swap request for:", userPublicKey, "speedMode:", speedMode, "feeCap:", priorityFeeCap, "feeBps:", feeBps);
  
  const body: Record<string, any> = {
    quoteResponse: quote,
    userPublicKey,
    wrapAndUnwrapSol,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: priorityFeeCap,
  };
  
  if (feeAccount && feeBps > 0) {
    body.feeAccount = feeAccount;
    body.platformFeeBps = feeBps;
  }
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), swapConfig.jupiterTimeoutMs);
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Cordon-Wallet/1.0",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    
    const responseText = await response.text();
    
    if (!response.ok) {
      console.error("[Jupiter] Build error:", response.status, responseText);
      return {
        ok: false,
        code: "BUILD_FAILED",
        message: `Jupiter build failed: ${response.status}`,
        details: responseText,
      };
    }
    
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      return {
        ok: false,
        code: "UPSTREAM",
        message: "Invalid JSON response from Jupiter swap",
        details: responseText,
      };
    }
    
    if (!data.swapTransaction) {
      return {
        ok: false,
        code: "BUILD_FAILED",
        message: "No swap transaction in response",
        details: data,
      };
    }
    
    return {
      ok: true,
      route: "jupiter",
      swapTransactionBase64: data.swapTransaction,
      lastValidBlockHeight: data.lastValidBlockHeight,
      prioritizationFeeLamports: priorityFeeCap,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    
    if (err.name === "AbortError") {
      return {
        ok: false,
        code: "BUILD_FAILED",
        message: "Jupiter build request timed out",
      };
    }
    
    console.error("[Jupiter] Build failed:", err);
    return {
      ok: false,
      code: "BUILD_FAILED",
      message: err.message || "Failed to build swap transaction",
    };
  }
}
