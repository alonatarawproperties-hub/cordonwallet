import { getQuote, getPlatformFeeParams, platformFeesAllowed } from "./jupiter";
import { swapConfig } from "./config";
import { quoteCache, quoteDeduper, pumpDetectionCache, pumpDetectionDeduper } from "./cache";

export interface FeeStatus {
  mode: "platformFee" | "disabled";
  reason?: string;
  outputMint?: string;
  feeBps?: number;
}

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
  fee?: FeeStatus;
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
    const isBuying = inputMint === SOL_MINT;
    const pumpMint = isBuying ? outputMint : inputMint;
    
    // For pump tokens (ending in "pump"), check bonding curve status FIRST
    // This prevents Jupiter from trying routes that don't work with Token-2022
    const looksLikePumpToken = pumpMint.toLowerCase().endsWith("pump");
    
    if (swapConfig.pumpModeEnabled && looksLikePumpToken) {
      console.log("[Route] Detected pump token format, checking bonding curve status first:", pumpMint);
      const pumpMeta = await detectPumpStatus(pumpMint);
      console.log("[Route] Pump detection result:", JSON.stringify(pumpMeta));
      
      // If confirmed on bonding curve, use pump route directly
      if (pumpMeta.isPump && pumpMeta.isBondingCurve) {
        console.log("[Route] Token is on bonding curve, using pump route");
        const routeResult: RouteQuoteResult = {
          ok: true,
          route: "pump",
          pumpMeta,
          message: "Token is on Pump.fun bonding curve",
        };
        quoteCache.set(cacheKey, routeResult);
        return routeResult;
      }
      
      // If token is graduated, try Jupiter but warn about potential Token-2022 issues
      if (pumpMeta.isGraduated) {
        console.log("[Route] Token is graduated from Pump.fun, trying Jupiter (may have Token-2022 issues)");
        // Fall through to Jupiter routing below
      } else {
        // If detection failed but it looks like a pump token, ALWAYS try pump first
        // The pumpportal API often fails detection, but trade-local still works
        console.log("[Route] Pump token (bonding curve assumed due to format), trying pump route");
        
        // Also fetch Jupiter quote as fallback for graduated tokens
        const jupiterFallback = await getQuote({
          inputMint,
          outputMint,
          amount,
          slippageBps,
          swapMode: "ExactIn",
        });
        
        const routeResult: RouteQuoteResult = {
          ok: true,
          route: "pump",
          pumpMeta: { ...pumpMeta, isPump: true, isBondingCurve: true },
          message: "Pump.fun token (bonding curve assumed)",
          // Include Jupiter quote as fallback
          quoteResponse: jupiterFallback.ok ? jupiterFallback.quote : undefined,
          normalized: jupiterFallback.ok ? jupiterFallback.normalized : undefined,
        };
        quoteCache.set(cacheKey, routeResult);
        return routeResult;
      }
    }
    
    // For non-pump tokens or graduated tokens, try Jupiter
    const jupiterResult = await getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
      swapMode: "ExactIn",
    });
    
    if (jupiterResult.ok) {
      // Platform fees are currently disabled - always return disabled status
      let feeStatus: FeeStatus;
      if (platformFeesAllowed()) {
        const feeResult = await getPlatformFeeParams(outputMint);
        feeStatus = feeResult.params
          ? { mode: "platformFee", feeBps: feeResult.params.feeBps }
          : { mode: "disabled", reason: feeResult.reason, outputMint: feeResult.normalizedMint };
      } else {
        feeStatus = { mode: "disabled", reason: "Platform fees disabled (kill-switch)" };
      }
      
      // Ensure quote has no platformFee (sanitize)
      const sanitizedQuote = { ...jupiterResult.quote, platformFee: null };
      
      const routeResult: RouteQuoteResult = {
        ok: true,
        route: "jupiter",
        quoteResponse: sanitizedQuote,
        normalized: jupiterResult.normalized,
        fee: feeStatus,
      };
      quoteCache.set(cacheKey, routeResult);
      return routeResult;
    }
    
    // If Jupiter fails with NO_ROUTE and it's a pump-format token, try pump route
    if (jupiterResult.code === "NO_ROUTE" && swapConfig.pumpModeEnabled && isPumpMintFormat(pumpMint)) {
      console.log("[Route] Jupiter has no route, falling back to pump for:", pumpMint);
      const pumpMeta = await detectPumpStatus(pumpMint);
      
      const routeResult: RouteQuoteResult = {
        ok: true,
        route: "pump",
        pumpMeta: { ...pumpMeta, isPump: true, isBondingCurve: true },
        message: "Fallback to Pump.fun bonding curve",
      };
      quoteCache.set(cacheKey, routeResult);
      return routeResult;
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
