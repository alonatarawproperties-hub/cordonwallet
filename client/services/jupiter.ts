import { JUPITER_API_URLS, SwapSpeed, SPEED_CONFIGS, LAMPORTS_PER_SOL } from "@/constants/solanaSwap";

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

async function tryFetch(url: string, options: RequestInit, timeoutMs: number = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  }
}

export async function getQuote(request: QuoteRequest): Promise<QuoteResponse> {
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount,
    slippageBps: request.slippageBps.toString(),
  });
  
  if (request.onlyDirectRoutes) {
    params.set("onlyDirectRoutes", "true");
  }
  
  const queryString = params.toString();
  let lastError: Error | null = null;
  
  // Try each Jupiter API endpoint
  for (let apiIdx = 0; apiIdx < JUPITER_API_URLS.length; apiIdx++) {
    const baseUrl = JUPITER_API_URLS[apiIdx].replace(/\/$/, "");
    const fullUrl = `${baseUrl}/v6/quote?${queryString}`;
    
    console.log(`[Jupiter] Trying endpoint ${apiIdx + 1}/${JUPITER_API_URLS.length}: ${baseUrl}`);
    
    // Retry logic for each endpoint
    const maxRetries = 1;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[Jupiter] Attempt ${attempt + 1}/${maxRetries + 1} on ${baseUrl}`);
        
        const response = await tryFetch(fullUrl, {
          method: "GET",
          headers: { 
            "Accept": "application/json",
          },
        });
        
        console.log("[Jupiter] Response status:", response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.log("[Jupiter] Error response:", errorText);
          if (response.status === 400 && errorText.includes("No routes found")) {
            throw new Error("No swap routes found. Try a larger amount or different tokens.");
          }
          throw new Error(`Quote failed (${response.status}): ${errorText}`);
        }
        
        const data = await response.json();
        console.log("[Jupiter] Quote success, output:", data.outAmount);
        return data;
      } catch (error: any) {
        console.log("[Jupiter] Fetch error:", error.name, error.message);
        lastError = error;
        
        // Don't retry on API errors (400, 404, etc), only on network errors
        if (error.message?.includes("Quote failed") || error.message?.includes("No routes")) {
          throw error;
        }
        
        // Retry on network/timeout errors
        if (attempt < maxRetries) {
          console.log("[Jupiter] Retrying after delay...");
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }
    
    // If this endpoint failed completely, try the next one
    console.log(`[Jupiter] Endpoint ${baseUrl} failed, trying next...`);
  }
  
  throw lastError || new Error("All Jupiter API endpoints failed. Check your network connection.");
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
  
  const request: SwapRequest = {
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: true,
    useSharedAccounts: true,
    dynamicComputeUnitLimit: true,
    skipUserAccountsRpcCalls: false,
    prioritizationFeeLamports,
  };
  
  let lastError: Error | null = null;
  
  for (const baseUrl of JUPITER_API_URLS) {
    const url = `${baseUrl.replace(/\/$/, "")}/v6/swap`;
    console.log("[Jupiter] Building swap transaction via:", url);
    
    try {
      const response = await tryFetch(url, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Swap build failed (${response.status}): ${errorText}`);
      }
      
      return response.json();
    } catch (error: any) {
      console.log("[Jupiter] Swap build error:", error.message);
      lastError = error;
      
      // Don't try next endpoint for API errors
      if (error.message?.includes("Swap build failed")) {
        throw error;
      }
    }
  }
  
  throw lastError || new Error("Failed to build swap transaction");
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
