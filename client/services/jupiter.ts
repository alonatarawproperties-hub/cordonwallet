import { JUPITER_API_URL, SwapSpeed, SPEED_CONFIGS, LAMPORTS_PER_SOL } from "@/constants/solanaSwap";

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
  const url = new URL("/v6/quote", JUPITER_API_URL);
  url.searchParams.set("inputMint", request.inputMint);
  url.searchParams.set("outputMint", request.outputMint);
  url.searchParams.set("amount", request.amount);
  url.searchParams.set("slippageBps", request.slippageBps.toString());
  
  if (request.onlyDirectRoutes) {
    url.searchParams.set("onlyDirectRoutes", "true");
  }
  
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "Accept": "application/json" },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jupiter quote failed: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

export async function buildSwapTransaction(
  quoteResponse: QuoteResponse,
  userPublicKey: string,
  mode: SwapSpeed,
  customCapSol?: number
): Promise<SwapResponse> {
  const config = SPEED_CONFIGS[mode];
  const capSol = customCapSol ?? config.capSol;
  const capMicroLamports = Math.floor(capSol * LAMPORTS_PER_SOL * 1_000_000);
  
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
  
  const response = await fetch(`${JUPITER_API_URL}/v6/swap`, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jupiter swap build failed: ${response.status} - ${errorText}`);
  }
  
  return response.json();
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
