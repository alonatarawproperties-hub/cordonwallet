import { getQuote } from "./jupiter";
import { swapConfig } from "./config";
import { quoteCache, quoteDeduper, pumpDetectionCache, pumpDetectionDeduper } from "./cache";

export interface RouteQuoteResult {
  ok: boolean;
  route: "jupiter" | "pump" | "none";
  quoteResponse?: any;
  pumpMeta?: PumpMeta;
  reason?: string;
  message?: string;
  normalized?: {
    outAmount: string;
    minOut: string;
    priceImpactPct: number;
    routePlan: any[];
  };
}

export interface PumpMeta {
  isPump: boolean;
  isBondingCurve: boolean;
  isGraduated: boolean;
  mint: string;
  updatedAt: number;
}

const SOL_MINT = "So11111111111111111111111111111111111111112";

function isPumpMintFormat(mint: string): boolean {
  return mint.toLowerCase().endsWith("pump") || mint.length === 44;
}

async function detectPumpStatus(mint: string): Promise<PumpMeta> {
  const cacheKey = `pump:${mint}`;
  
  const cached = pumpDetectionCache.get(cacheKey);
  if (cached) return cached;
  
  return pumpDetectionDeduper.dedupe(cacheKey, async () => {
    try {
      const url = `${swapConfig.pumpPortalBaseUrl}/api/token/${mint}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        const meta: PumpMeta = {
          isPump: false,
          isBondingCurve: false,
          isGraduated: false,
          mint,
          updatedAt: Date.now(),
        };
        pumpDetectionCache.set(cacheKey, meta);
        return meta;
      }
      
      const data = await response.json();
      
      const meta: PumpMeta = {
        isPump: true,
        isBondingCurve: data.complete === false,
        isGraduated: data.complete === true,
        mint,
        updatedAt: Date.now(),
      };
      
      pumpDetectionCache.set(cacheKey, meta);
      return meta;
    } catch (err: any) {
      console.warn("[Route] Pump detection failed for", mint, err.message);
      
      const meta: PumpMeta = {
        isPump: isPumpMintFormat(mint),
        isBondingCurve: false,
        isGraduated: false,
        mint,
        updatedAt: Date.now(),
      };
      pumpDetectionCache.set(cacheKey, meta);
      return meta;
    }
  });
}

export async function getRouteQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
}): Promise<RouteQuoteResult> {
  const { inputMint, outputMint, amount, slippageBps } = params;
  
  const cacheKey = `route:${inputMint}:${outputMint}:${amount}:${slippageBps}`;
  
  const cached = quoteCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  
  const result = await quoteDeduper.dedupe(cacheKey, async () => {
    const jupiterResult = await getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
      swapMode: "ExactIn",
    });
    
    if (jupiterResult.ok) {
      const routeResult: RouteQuoteResult = {
        ok: true,
        route: "jupiter",
        quoteResponse: jupiterResult.quote,
        normalized: jupiterResult.normalized,
      };
      quoteCache.set(cacheKey, routeResult);
      return routeResult;
    }
    
    if (jupiterResult.code === "NO_ROUTE" && swapConfig.pumpModeEnabled) {
      const isBuying = inputMint === SOL_MINT;
      const pumpMint = isBuying ? outputMint : inputMint;
      
      const pumpMeta = await detectPumpStatus(pumpMint);
      
      if (pumpMeta.isPump && pumpMeta.isBondingCurve) {
        const routeResult: RouteQuoteResult = {
          ok: true,
          route: "pump",
          pumpMeta,
          message: "Token is on Pump.fun bonding curve",
        };
        quoteCache.set(cacheKey, routeResult);
        return routeResult;
      }
      
      if (pumpMeta.isPump && pumpMeta.isGraduated) {
        return {
          ok: false,
          route: "none",
          reason: "GRADUATED_NO_LIQUIDITY",
          message: "Token graduated from Pump.fun but has no Jupiter liquidity yet",
        };
      }
    }
    
    return {
      ok: false,
      route: "none",
      reason: jupiterResult.code || "NO_ROUTE",
      message: jupiterResult.message || "No liquidity or route available",
    };
  });
  
  return result;
}

export async function getPumpMeta(mint: string): Promise<PumpMeta> {
  return detectPumpStatus(mint);
}
