import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { swapConfig, getPriorityFeeCap, SpeedMode, CORDON_TREASURY_WALLET, platformFeeConfig, isPlatformFeeEnabled } from "./config";
import type { QuoteResult, BuildResult } from "./types";

// Fallback Jupiter base URL for 429 / 5xx retry
const JUPITER_FALLBACK_BASE_URL = "https://lite-api.jup.ag";
const MAX_429_RETRIES = 3;
const RETRY_DELAYS_MS = [300, 800, 1500];

// Build common headers for Jupiter API requests (includes API key if configured)
function jupiterHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "Cordon-Wallet/1.0",
    ...extra,
  };
  if (swapConfig.jupiterApiKey) {
    headers["x-api-key"] = swapConfig.jupiterApiKey;
  }
  return headers;
}

console.log(`[Jupiter] Base URL: ${swapConfig.jupiterBaseUrl} | API key: ${swapConfig.jupiterApiKey ? "configured" : "none"}`);

/**
 * Fetch wrapper with 429 rate-limit retry + fallback URL.
 * Tries the primary URL first, retries with backoff on 429/5xx,
 * then falls back to the alternate Jupiter endpoint.
 */
async function fetchJupiterWithRetry(
  path: string,
  init: RequestInit & { method: string },
  timeoutMs: number
): Promise<Response> {
  const urls = [
    `${swapConfig.jupiterBaseUrl}${path}`,
    `${JUPITER_FALLBACK_BASE_URL}${path}`,
  ];

  let lastResponse: Response | null = null;

  for (const url of urls) {
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
          lastResponse = response;
          const delay = RETRY_DELAYS_MS[attempt] || 1500;
          console.warn(`[Jupiter] ${response.status} on ${url}, retry ${attempt + 1}/${MAX_429_RETRIES} in ${delay}ms`);
          if (attempt < MAX_429_RETRIES) {
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          // Exhausted retries on this URL, try fallback
          break;
        }

        return response;
      } catch (err: any) {
        clearTimeout(timeout);
        if (attempt < MAX_429_RETRIES && err.name !== "AbortError") {
          await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt] || 500));
          continue;
        }
        // On abort or exhausted retries, try fallback URL
        if (url === urls[urls.length - 1]) throw err;
        console.warn(`[Jupiter] ${url} failed (${err.message}), trying fallback`);
        break;
      }
    }
  }

  // Should only reach here if all retries on all URLs returned 429/5xx
  return lastResponse!;
}

const NATIVE_SOL_MINT = "11111111111111111111111111111111";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

function normalizeToWsol(mint: string): string {
  if (mint === NATIVE_SOL_MINT || mint.toLowerCase() === "sol") {
    return WSOL_MINT;
  }
  return mint;
}

// ── Simple ATA-based fee system (no Jupiter Referral Program needed) ──
// Just uses regular Associated Token Accounts on the treasury wallet.
// Fee collection works for any token where the treasury has an ATA.

const feeAccountCache = new Map<string, { ata: string | null; checkedAt: number }>();
const FEE_CACHE_TTL_OK = 3600_000;     // 1 hour for existing accounts
const FEE_CACHE_TTL_MISSING = 300_000;  // 5 min for missing accounts

/**
 * Resolve the fee account (ATA) for a given output mint on the treasury wallet.
 * Returns the ATA address if it exists on-chain, null otherwise.
 * Results are cached to avoid repeated RPC calls.
 */
export async function resolveFeeAccount(outputMint: string): Promise<string | null> {
  if (!isPlatformFeeEnabled()) return null;

  const mint = normalizeToWsol(outputMint);

  // Check manual overrides first
  if (platformFeeConfig.knownFeeAccounts[mint]) {
    return platformFeeConfig.knownFeeAccounts[mint];
  }

  // Check cache
  const cached = feeAccountCache.get(mint);
  if (cached) {
    const ttl = cached.ata ? FEE_CACHE_TTL_OK : FEE_CACHE_TTL_MISSING;
    if (Date.now() - cached.checkedAt < ttl) {
      return cached.ata;
    }
  }

  // Compute ATA address deterministically
  try {
    const treasuryPubkey = new PublicKey(CORDON_TREASURY_WALLET);
    const mintPubkey = new PublicKey(mint);
    const ata = await getAssociatedTokenAddress(mintPubkey, treasuryPubkey);
    const ataStr = ata.toBase58();

    // Check if ATA exists on-chain
    const connection = new Connection(swapConfig.solanaRpcUrl, { commitment: "confirmed" });
    const accountInfo = await Promise.race([
      connection.getAccountInfo(ata),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);

    if (accountInfo) {
      console.log(`[SwapFee] ATA exists for ${mint.slice(0, 8)}...: ${ataStr.slice(0, 8)}...`);
      feeAccountCache.set(mint, { ata: ataStr, checkedAt: Date.now() });
      return ataStr;
    } else {
      console.log(`[SwapFee] ATA not found for ${mint.slice(0, 8)}... Fee skipped for this mint.`);
      feeAccountCache.set(mint, { ata: null, checkedAt: Date.now() });
      return null;
    }
  } catch (err: any) {
    console.warn(`[SwapFee] Error resolving ATA for ${mint.slice(0, 8)}...: ${err.message}`);
    feeAccountCache.set(mint, { ata: null, checkedAt: Date.now() });
    return null;
  }
}

export function platformFeesAllowed(): boolean {
  return isPlatformFeeEnabled();
}

console.log("[SwapFee] Platform fees enabled:", isPlatformFeeEnabled(),
  "| feeBps:", platformFeeConfig.feeBps,
  "| treasury:", CORDON_TREASURY_WALLET.slice(0, 8) + "...");

export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  swapMode: string;
  includePlatformFee?: boolean;
}): Promise<QuoteResult> {
  const { inputMint, outputMint, amount, slippageBps, swapMode, includePlatformFee = false } = params;
  
  const queryParams = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: slippageBps.toString(),
    swapMode,
  });
  
  // Add platformFeeBps when the caller confirmed a fee account exists
  if (includePlatformFee && platformFeesAllowed()) {
    queryParams.set("platformFeeBps", platformFeeConfig.feeBps.toString());
    console.log("[SwapFee] Quote includes platformFeeBps:", platformFeeConfig.feeBps);
  }
  
  const quotePath = `${swapConfig.jupiterQuotePath}?${queryParams.toString()}`;
  console.log("[Jupiter] Quote request:", quotePath);

  try {
    const response = await fetchJupiterWithRetry(
      quotePath,
      {
        method: "GET",
        headers: jupiterHeaders(),
      },
      swapConfig.jupiterTimeoutMs
    );
    
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
    
    // Log fee status
    if (quote.platformFee) {
      console.log("[SwapFee] Quote has platformFee:", JSON.stringify(quote.platformFee));
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

// Sanitize quote for swap: strip platformFee only if we're NOT collecting fees
export function sanitizeQuoteForSwap(quoteResponse: any, keepPlatformFee: boolean): any {
  if (!quoteResponse) return quoteResponse;
  if (keepPlatformFee) return quoteResponse;

  const { platformFee, ...sanitized } = quoteResponse;
  return { ...sanitized, platformFee: null };
}

export async function buildSwapTransaction(params: {
  userPublicKey: string;
  quote: any;
  speedMode: SpeedMode;
  maxPriorityFeeLamports?: number;
  wrapAndUnwrapSol: boolean;
  disablePlatformFee?: boolean;
  feeAccount?: string | null;
}): Promise<BuildResult> {
  const { userPublicKey, quote, speedMode, maxPriorityFeeLamports } = params;

  const priorityFeeCap = getPriorityFeeCap(speedMode, maxPriorityFeeLamports);

  // Determine if output is SOL/WSOL - requires special handling
  const outputMint = quote?.outputMint || "";
  const isSolOutput = outputMint === WSOL_MINT;
  const effectiveWrapAndUnwrapSol = isSolOutput ? true : params.wrapAndUnwrapSol;

  // Resolve fee account: use passed-in value, or resolve from output mint
  let feeAccount = params.feeAccount;
  if (feeAccount === undefined && !params.disablePlatformFee) {
    feeAccount = await resolveFeeAccount(outputMint);
  }

  // Sanitize quote: keep platformFee in quote only if we have a valid fee account
  const hasFee = !!feeAccount;
  const sanitizedQuote = sanitizeQuoteForSwap(quote, hasFee);

  const url = `${swapConfig.jupiterBaseUrl}${swapConfig.jupiterSwapPath}`;

  const body: Record<string, any> = {
    quoteResponse: sanitizedQuote,
    userPublicKey,
    wrapAndUnwrapSol: effectiveWrapAndUnwrapSol,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: priorityFeeCap,
  };

  // Add fee account if we have one
  if (feeAccount) {
    body.feeAccount = feeAccount;
    console.log("[Jupiter] Build swap with fee:", {
      user: userPublicKey.slice(0, 8) + "...",
      speedMode,
      priorityFeeCap,
      feeAccount: feeAccount.slice(0, 8) + "...",
      feeBps: platformFeeConfig.feeBps,
    });
  } else {
    console.log("[Jupiter] Build swap (no fee):", {
      user: userPublicKey.slice(0, 8) + "...",
      speedMode,
      priorityFeeCap,
    });
  }

  const result = await executeSwapBuild(url, body);

  // If build failed with fee, retry WITHOUT fee so the swap still works
  if (!result.ok && feeAccount) {
    console.warn("[Jupiter] Build with fee failed, retrying without fee. Error:", (result as any).details?.slice?.(0, 200) || (result as any).message);
    const noFeeBody = { ...body };
    delete noFeeBody.feeAccount;
    noFeeBody.quoteResponse = sanitizeQuoteForSwap(quote, false);
    const retryResult = await executeSwapBuild(url, noFeeBody);
    if (retryResult.ok) {
      console.log("[Jupiter] Build succeeded without fee (fee skipped for this swap)");
    }
    return retryResult;
  }

  return result;
}

async function executeSwapBuild(url: string, body: Record<string, any>): Promise<BuildResult> {
  try {
    const response = await fetchJupiterWithRetry(
      swapConfig.jupiterSwapPath,
      {
        method: "POST",
        headers: jupiterHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      },
      swapConfig.jupiterTimeoutMs
    );
    
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
      prioritizationFeeLamports: body.prioritizationFeeLamports,
    };
  } catch (err: any) {
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

export function getPlatformFeeStatus(): {
  enabled: boolean;
  feeBps: number;
  treasury: string;
} {
  return {
    enabled: platformFeesAllowed(),
    feeBps: platformFeeConfig.feeBps,
    treasury: CORDON_TREASURY_WALLET,
  };
}
