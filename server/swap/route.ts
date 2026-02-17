import { getQuote, resolveFeeAccount, platformFeesAllowed } from "./jupiter";
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
  feeAccount?: string;
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
        // Detection inconclusive. For SELLs of pump-format mints, prefer Pump first
        // to avoid routing bonding-curve tokens through Jupiter and failing on-chain.
        if (!isBuying) {
          console.log("[Route] Pump token sell (detection inconclusive), using Pump route first");
          const routeResult: RouteQuoteResult = {
            ok: true,
            route: "pump",
            pumpMeta: { ...pumpMeta, isPump: true, isBondingCurve: true },
            message: "Pump.fun sell fallback for inconclusive detection",
          };
          quoteCache.set(cacheKey, routeResult);
          return routeResult;
        }

        // For BUYs keep Jupiter-first fallback behavior (works for graduated tokens).
        console.log("[Route] Pump token buy (detection inconclusive), trying Jupiter first with pump fallback");

        // Resolve fee account so the quote includes platformFeeBps
        const pumpFeeAccount = await resolveFeeAccount(outputMint);
        const pumpIncludeFee = !!pumpFeeAccount;

        const jupiterFallback = await getQuote({
          inputMint,
          outputMint,
          amount,
          slippageBps,
          swapMode: "ExactIn",
          includePlatformFee: pumpIncludeFee,
        });

        if (jupiterFallback.ok) {
          // Jupiter has a route — use it (token may be graduated or have DEX liquidity)
          console.log("[Route] Jupiter has route for pump-format token, using Jupiter");
          const pumpFeeStatus: FeeStatus = pumpFeeAccount
            ? { mode: "platformFee", feeBps: 50 }
            : { mode: "disabled", reason: "No fee account for output mint" };

          const routeResult: RouteQuoteResult = {
            ok: true,
            route: "jupiter",
            quoteResponse: jupiterFallback.quote,
            normalized: jupiterFallback.normalized,
            pumpMeta,
            fee: pumpFeeStatus,
            feeAccount: pumpFeeAccount || undefined,
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
    // Resolve fee account BEFORE quoting so the quote reflects the fee
    const feeAccount = await resolveFeeAccount(outputMint);
    const includeFee = !!feeAccount;

    const jupiterResult = await getQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
      swapMode: "ExactIn",
      includePlatformFee: includeFee,
    });

    if (jupiterResult.ok) {
      const feeStatus: FeeStatus = feeAccount
        ? { mode: "platformFee", feeBps: 50 }
        : { mode: "disabled", reason: "No fee account for output mint" };

      const routeResult: RouteQuoteResult = {
        ok: true,
        route: "jupiter",
        quoteResponse: jupiterResult.quote,
        normalized: jupiterResult.normalized,
        fee: feeStatus,
        feeAccount: feeAccount || undefined,
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
