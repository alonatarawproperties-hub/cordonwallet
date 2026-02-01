import { SwapSpeed, SPEED_CONFIGS, LAMPORTS_PER_SOL } from "@/constants/solanaSwap";
import { getApiUrl, getApiHeaders } from "@/lib/query-client";

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  onlyDirectRoutes?: boolean;
  swapMode?: "ExactIn" | "ExactOut";
}

export interface RouteInfo {
  label: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  feeAmount: string;
  feeMint: string;
}

export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: RouteInfo[];
  contextSlot: number;
  timeTaken: number;
}

export interface SwapRequest {
  quoteResponse: QuoteResponse;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
  useSharedAccounts?: boolean;
  computeUnitPriceMicroLamports?: number;
  prioritizationFeeLamports?: number | "auto";
  dynamicComputeUnitLimit?: boolean;
  skipUserAccountsRpcCalls?: boolean;
}

export interface SwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports?: number;
  computeUnitLimit?: number;
  prioritizationType?: {
    computeBudget?: {
      microLamports: number;
      estimatedMicroLamports: number;
    };
  };
}

export async function getQuote(request: QuoteRequest): Promise<QuoteResponse> {
  const baseUrl = getApiUrl();
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount,
    slippageBps: request.slippageBps.toString(),
    swapMode: "ExactIn",
  });
  
  if (request.onlyDirectRoutes) {
    params.set("onlyDirectRoutes", "true");
  }
  
  const url = `${baseUrl}/api/jupiter/quote?${params.toString()}`;
  console.log("[Jupiter] Requesting quote via server proxy");
  
  const maxRetries = 2;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Jupiter] Attempt ${attempt + 1}/${maxRetries + 1}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      
      const response = await fetch(url, {
        method: "GET",
        headers: getApiHeaders({ "Accept": "application/json" }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      console.log("[Jupiter] Response status:", response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        console.log("[Jupiter] Error response:", errorData);
        
        if (response.status === 400 && JSON.stringify(errorData).includes("No routes")) {
          throw new Error("No swap routes found. Try a larger amount or different tokens.");
        }
        throw new Error(`Quote failed (${response.status}): ${errorData.error || JSON.stringify(errorData)}`);
      }
      
      const data = await response.json();
      console.log("[Jupiter] Quote success, output:", data.outAmount);
      return data;
    } catch (error: any) {
      console.log("[Jupiter] Fetch error:", error.name, error.message);
      lastError = error;
      
      if (error.name === "AbortError") {
        lastError = new Error("Request timed out. Please try again.");
      }
      
      if (error.message?.includes("Quote failed") || error.message?.includes("No routes")) {
        throw error;
      }
      
      if (attempt < maxRetries) {
        console.log("[Jupiter] Retrying after delay...");
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  
  throw lastError || new Error("Failed to get quote. Check your network connection.");
}

export async function buildSwapTransaction(
  quoteResponse: QuoteResponse,
  userPublicKey: string,
  mode: SwapSpeed,
  customCapSol?: number
): Promise<SwapResponse> {
  const config = SPEED_CONFIGS[mode];
  const capSol = customCapSol ?? config.capSol;
  
  let prioritizationFeeLamports: number | "auto" = "auto";
  if (mode === "turbo") {
    prioritizationFeeLamports = Math.floor(capSol * LAMPORTS_PER_SOL * 0.8);
  } else if (mode === "fast") {
    prioritizationFeeLamports = Math.floor(capSol * LAMPORTS_PER_SOL * 0.5);
  }
  
  const baseUrl = getApiUrl();
  const url = `${baseUrl}/api/jupiter/swap`;
  
  // Try with shared accounts disabled first (better Token-2022 compatibility), then with shared
  // Many newer tokens use Token-2022 which has issues with shared accounts
  for (const useSharedAccounts of [false, true]) {
    const request: SwapRequest = {
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      useSharedAccounts,
      dynamicComputeUnitLimit: true,
      skipUserAccountsRpcCalls: false,
      prioritizationFeeLamports,
    };
    
    console.log(`[Jupiter] Building swap transaction (sharedAccounts=${useSharedAccounts})`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: getApiHeaders({
          "Accept": "application/json",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        const errorStr = JSON.stringify(errorData);
        
        // If AMM/Token-2022 compatibility error, try with different shared accounts setting
        if (errorStr.includes("Simple AMMs are not supported with shared accounts") ||
            errorStr.includes("0x177e") ||
            errorStr.includes("IncorrectTokenProgramID")) {
          console.log("[Jupiter] Compatibility issue detected, trying alternate mode...");
          continue;
        }
        
        throw new Error(`Swap build failed (${response.status}): ${errorData.error || errorStr}`);
      }
      
      return response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      // If it's the Simple AMM error from our throw, continue to retry
      if (useSharedAccounts && error.message?.includes("Simple AMMs are not supported")) {
        continue;
      }
      
      if (error.name === "AbortError") {
        throw new Error("Swap request timed out. Please try again.");
      }
      throw error;
    }
  }
  
  throw new Error("Failed to build swap transaction after retries.");
}

export function calculatePriceImpact(quoteResponse: QuoteResponse): {
  impactPct: number;
  severity: "low" | "medium" | "high" | "critical";
} {
  const impactPct = parseFloat(quoteResponse.priceImpactPct);
  
  let severity: "low" | "medium" | "high" | "critical" = "low";
  if (impactPct > 5) {
    severity = "critical";
  } else if (impactPct > 2) {
    severity = "high";
  } else if (impactPct > 0.5) {
    severity = "medium";
  }
  
  return { impactPct, severity };
}

export function formatRoute(quoteResponse: QuoteResponse): string {
  if (!quoteResponse.routePlan || quoteResponse.routePlan.length === 0) {
    return "Direct";
  }
  
  const labels = quoteResponse.routePlan.map(r => r.label).filter(Boolean);
  if (labels.length === 0) return "Jupiter";
  if (labels.length === 1) return labels[0];
  
  return labels.slice(0, 3).join(" → ") + (labels.length > 3 ? ` +${labels.length - 3}` : "");
}

export function estimateNetworkFee(swapResponse: SwapResponse): {
  feeLamports: number;
  feeSol: number;
} {
  const baseFee = 5000;
  const priorityFee = swapResponse.prioritizationFeeLamports || 0;
  const totalLamports = baseFee + priorityFee;
  
  return {
    feeLamports: totalLamports,
    feeSol: totalLamports / LAMPORTS_PER_SOL,
  };
}
