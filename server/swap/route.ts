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
  // Only match mints that literally end in "pump" — length === 44 was a false positive
  // since nearly ALL Solana mints are 44 chars (base58-encoded 32 bytes)
  return mint.toLowerCase().endsWith("pump");
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
        // Detection was inconclusive — try Jupiter first (works for graduated tokens),
        // only fall back to Pump if Jupiter has no route
        console.log("[Route] Pump token (detection inconclusive), trying Jupiter first with pump fallback");

        const jupiterFallback = await getQuote({
          inputMint,
          outputMint,
          amount,
          slippageBps,
          swapMode: "ExactIn",
        });

        if (jupiterFallback.ok) {
          // Jupiter has a route — use it (token may be graduated or have DEX liquidity)
          console.log("[Route] Jupiter has route for pump-format token, using Jupiter");
          const routeResult: RouteQuoteResult = {
            ok: true,
            route: "jupiter",
            quoteResponse: jupiterFallback.quote,
            normalized: jupiterFallback.normalized,
            pumpMeta,
          };
          quoteCache.set(cacheKey, routeResult);
          return routeResult;
        }

        // Jupiter has no route — assume bonding curve and try pump
        console.log("[Route] Jupiter has no route, assuming bonding curve for pump-format token");
        const routeResult: RouteQuoteResult = {
          ok: true,
          route: "pump",
          pumpMeta: { ...pumpMeta, isPump: true, isBondingCurve: true },
          message: "Pump.fun bonding curve (Jupiter has no route)",
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
      let feeStatus: FeeStatus;
      if (platformFeesAllowed()) {
        const feeResult = await getPlatformFeeParams(outputMint);
        feeStatus = feeResult.params
          ? { mode: "platformFee", feeBps: feeResult.params.feeBps }
          : { mode: "disabled", reason: feeResult.reason, outputMint: feeResult.normalizedMint };
      } else {
        feeStatus = { mode: "disabled", reason: "Platform fees disabled by config" };
      }

      const routeResult: RouteQuoteResult = {
        ok: true,
        route: "jupiter",
        quoteResponse: jupiterResult.quote,
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

      // Only force isBondingCurve if detection confirmed it OR detection failed
      // (if detection says NOT pump, don't override — just report no route)
      if (!pumpMeta.isPump && pumpMeta.updatedAt > 0) {
        // PumpPortal explicitly said this is NOT a pump token
        return {
          ok: false,
          route: "none",
          reason: "NO_ROUTE",
          message: "No liquidity or route available",
        };
      }

      const routeResult: RouteQuoteResult = {
        ok: true,
        route: "pump",
        pumpMeta: { ...pumpMeta, isPump: true, isBondingCurve: !pumpMeta.isGraduated },
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
