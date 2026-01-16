import { SwapSpeed, SPEED_CONFIGS, LAMPORTS_PER_SOL } from "@/constants/solanaSwap";
import { getApiUrl } from "@/lib/query-client";

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  onlyDirectRoutes?: boolean;
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
  
  const url = `${baseUrl}/api/swap/solana/quote?${params.toString()}`;
  console.log("[Jupiter] Requesting quote via new swap API");
  
  const maxRetries = 2;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Jupiter] Attempt ${attempt + 1}/${maxRetries + 1}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      
      const response = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      console.log("[Jupiter] Response status:", response.status);
      
      const data = await response.json();
      
      if (!response.ok || !data.ok) {
        console.log("[Jupiter] Error response:", data);
        
        if (data.code === "NO_ROUTE" || (data.message && data.message.includes("No route"))) {
          throw new Error("No swap routes found. Try a larger amount or different tokens.");
        }
        throw new Error(`Quote failed: ${data.message || data.error || "Unknown error"}`);
      }
      
      console.log("[Jupiter] Quote success, output:", data.normalized?.outAmount);
      return data.quote;
    } catch (error: any) {
      console.log("[Jupiter] Fetch error:", error.name, error.message);
      lastError = error;
      
      if (error.name === "AbortError") {
        lastError = new Error("Request timed out. Please try again.");
      }
      
      if (error.message?.includes("Quote failed") || error.message?.includes("No routes") || error.message?.includes("No swap")) {
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

function speedToMode(speed: SwapSpeed): "standard" | "fast" | "turbo" {
  return speed;
}

export async function buildSwapTransaction(
  quoteResponse: QuoteResponse,
  userPublicKey: string,
  mode: SwapSpeed,
  customCapSol?: number
): Promise<SwapResponse> {
  const config = SPEED_CONFIGS[mode];
  const capSol = customCapSol ?? config.capSol;
  const maxPriorityFeeLamports = Math.floor(capSol * LAMPORTS_PER_SOL);
  
  const baseUrl = getApiUrl();
  const url = `${baseUrl}/api/swap/solana/build`;
  console.log("[Jupiter] Building swap transaction via new swap API");
  
  const body = {
    userPublicKey,
    quote: quoteResponse,
    speedMode: speedToMode(mode),
    maxPriorityFeeLamports,
    wrapAndUnwrapSol: true,
  };
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const data = await response.json();
    
    if (!response.ok || !data.ok) {
      throw new Error(`Swap build failed: ${data.message || data.error || "Unknown error"}`);
    }
    
    return {
      swapTransaction: data.swapTransactionBase64,
      lastValidBlockHeight: data.lastValidBlockHeight || 0,
      prioritizationFeeLamports: data.prioritizationFeeLamports,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Swap request timed out. Please try again.");
    }
    throw error;
  }
}

export async function sendSignedTransaction(
  signedTxBase64: string,
  mode: SwapSpeed = "standard"
): Promise<{ signature: string; rpc: string }> {
  const baseUrl = getApiUrl();
  const url = `${baseUrl}/api/swap/solana/send`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      signedTransactionBase64: signedTxBase64,
      mode: speedToMode(mode),
    }),
  });
  
  const data = await response.json();
  
  if (!response.ok || !data.ok) {
    throw new Error(`Send failed: ${data.message || data.error || "Unknown error"}`);
  }
  
  return {
    signature: data.signature,
    rpc: data.rpc,
  };
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
