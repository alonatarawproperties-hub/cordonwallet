import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { swapConfig, getPriorityFeeCap, SpeedMode, CORDON_TREASURY_WALLET, CORDON_SUCCESS_FEE_BPS, platformFeeConfig, isPlatformFeeEnabled } from "./config";
import type { QuoteResult, BuildResult } from "./types";

// KILL-SWITCH: Force disable Jupiter platform fees until 0x1788 error is resolved
const FORCE_DISABLE_JUPITER_PLATFORM_FEES = true;

// Helper: Central check for platform fee permission
export function platformFeesAllowed(): boolean {
  if (FORCE_DISABLE_JUPITER_PLATFORM_FEES) {
    return false;
  }
  return isPlatformFeeEnabled();
}

// Log once at module load
if (FORCE_DISABLE_JUPITER_PLATFORM_FEES) {
  console.log("[JupiterFee] Disabled - Jupiter platform/referral fees are OFF");
} else {
  console.log("[JupiterFee] platformFeesAllowed:", platformFeesAllowed());
}

const JUPITER_REFERRAL_PROGRAM = "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3";

// Fallback Jupiter base URL for 429 / 5xx retry
const JUPITER_FALLBACK_BASE_URL = swapConfig.jupiterBaseUrl.includes("lite-api")
  ? "https://api.jup.ag"
  : "https://lite-api.jup.ag";
const MAX_429_RETRIES = 3;
const RETRY_DELAYS_MS = [300, 800, 1500];

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

function deriveFeeAccountAddress(referralAccount: string, mint: string): string | null {
  // Guard: Never derive if platform fees are disabled
  if (!platformFeesAllowed()) {
    return null;
  }
  
  try {
    const referralPubkey = new PublicKey(referralAccount);
    const mintPubkey = new PublicKey(mint);
    const programId = new PublicKey(JUPITER_REFERRAL_PROGRAM);
    
    const [feeAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("referral_ata"),
        referralPubkey.toBuffer(),
        mintPubkey.toBuffer(),
      ],
      programId
    );
    
    return feeAccount.toBase58();
  } catch (err: any) {
    console.warn(`[SwapFee] Failed to derive fee account: ${err.message}`);
    return null;
  }
}

interface FeeAccountResult {
  feeAccount: string | null;
  feeBps: number;
  reason: string;
}

export interface PlatformFeeParams {
  feeAccount: string;
  feeBps: number;
}

export interface PlatformFeeResult {
  params: PlatformFeeParams | null;
  reason: string;
  outputMint: string;
  normalizedMint: string;
}

export async function getPlatformFeeParams(outputMint: string): Promise<PlatformFeeResult> {
  const normalizedMint = normalizeToWsol(outputMint);
  
  // Early exit if platform fees are disabled
  if (!platformFeesAllowed()) {
    const reason = FORCE_DISABLE_JUPITER_PLATFORM_FEES 
      ? "Platform fee FORCED OFF (kill-switch)" 
      : "Platform fee disabled by config";
    return { params: null, reason, outputMint, normalizedMint };
  }
  
  console.log(`[SwapFee] getPlatformFeeParams: outputMint=${outputMint.slice(0, 8)}..., normalizedMint=${normalizedMint.slice(0, 8)}...`);
  
  if (platformFeeConfig.knownFeeAccounts[normalizedMint]) {
    const feeAccount = platformFeeConfig.knownFeeAccounts[normalizedMint];
    console.log(`[SwapFee] Using known fee account for ${normalizedMint.slice(0, 8)}...`);
    return { 
      params: { feeAccount, feeBps: platformFeeConfig.feeBps },
      reason: "Known fee account",
      outputMint,
      normalizedMint,
    };
  }
  
  const derivedAccount = deriveFeeAccountAddress(platformFeeConfig.referralAccount, normalizedMint);
  if (!derivedAccount) {
    console.log(`[SwapFee] Could not derive fee account for ${normalizedMint.slice(0, 8)}... Fee OFF.`);
    return { params: null, reason: "Derivation failed", outputMint, normalizedMint };
  }
  
  console.log(`[SwapFee] Derived feeAccount=${derivedAccount.slice(0, 8)}... for ${normalizedMint.slice(0, 8)}...`);
  
  try {
    const connection = new Connection(swapConfig.solanaRpcUrl, { commitment: "confirmed" });
    const accountInfo = await Promise.race([
      connection.getAccountInfo(new PublicKey(derivedAccount)),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
    
    if (accountInfo) {
      console.log(`[SwapFee] Fee account EXISTS for ${normalizedMint.slice(0, 8)}..., applying ${platformFeeConfig.feeBps}bps`);
      return { 
        params: { feeAccount: derivedAccount, feeBps: platformFeeConfig.feeBps },
        reason: "Verified on-chain",
        outputMint,
        normalizedMint,
      };
    } else {
      console.log(`[SwapFee] Fee account NOT FOUND for ${normalizedMint.slice(0, 8)}... Fee OFF.`);
      return { params: null, reason: "Fee account not initialized", outputMint, normalizedMint };
    }
  } catch (err: any) {
    console.warn(`[SwapFee] Verification error: ${err.message}. Fee OFF.`);
    return { params: null, reason: `Verification error: ${err.message}`, outputMint, normalizedMint };
  }
}

async function resolvePlatformFeeAccount(
  outputMint: string,
  inputMint: string,
  swapMode: string
): Promise<FeeAccountResult> {
  // Guard: Never resolve if platform fees are disabled
  if (!platformFeesAllowed()) {
    return { feeAccount: null, feeBps: 0, reason: "Platform fees disabled" };
  }
  
  const feeMint = swapMode === "ExactOut" ? inputMint : outputMint;
  const result = await getPlatformFeeParams(feeMint);
  
  if (result.params) {
    return { 
      feeAccount: result.params.feeAccount, 
      feeBps: result.params.feeBps, 
      reason: result.reason 
    };
  }
  return { feeAccount: null, feeBps: 0, reason: result.reason };
}

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
  
  // ONLY add platformFeeBps if fees are explicitly allowed
  if (includePlatformFee && platformFeesAllowed()) {
    queryParams.set("platformFeeBps", platformFeeConfig.feeBps.toString());
    console.log("[SwapFee] Adding platformFeeBps to quote:", platformFeeConfig.feeBps);
  }
  
  const quotePath = `${swapConfig.jupiterQuotePath}?${queryParams.toString()}`;
  console.log("[Jupiter] Quote request:", quotePath);

  try {
    const response = await fetchJupiterWithRetry(
      quotePath,
      {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "Cordon-Wallet/1.0",
        },
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
    
    // Strip platformFee from response if platform fees are disabled
    if (!platformFeesAllowed()) {
      quote.platformFee = null;
    }
    
    // Log fee status
    console.log("[SwapFee] platformFeesAllowed:", platformFeesAllowed(), "quote.platformFee:", quote.platformFee ?? null);
    
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

// Sanitize quote for swap: remove ALL platform fee fields
export function sanitizeQuoteForSwap(quoteResponse: any): any {
  if (!quoteResponse) return quoteResponse;
  
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
}): Promise<BuildResult> {
  const { userPublicKey, quote, speedMode, maxPriorityFeeLamports } = params;
  
  const priorityFeeCap = getPriorityFeeCap(speedMode, maxPriorityFeeLamports);
  
  // ALWAYS sanitize quote - never allow platform fee fields
  const sanitizedQuote = sanitizeQuoteForSwap(quote);
  
  // Determine if output is SOL/WSOL - requires special handling
  const outputMint = quote?.outputMint || "";
  const isSolOutput = outputMint === WSOL_MINT;
  
  // For SOL output: MUST use wrapAndUnwrapSol=true, and NO destination token account
  const effectiveWrapAndUnwrapSol = isSolOutput ? true : params.wrapAndUnwrapSol;
  
  const url = `${swapConfig.jupiterBaseUrl}${swapConfig.jupiterSwapPath}`;

  // Simple swap body — just priority fee, no platform fees, no Jito tips.
  const body: Record<string, any> = {
    quoteResponse: sanitizedQuote,
    userPublicKey,
    wrapAndUnwrapSol: effectiveWrapAndUnwrapSol,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: priorityFeeCap,
  };

  console.log("[Jupiter] Build swap:", {
    user: userPublicKey.slice(0, 8) + "...",
    speedMode,
    priorityFeeCap,
  });

  const result = await executeSwapBuild(url, body);

  return result;
}

function isFeeAccountError(details: string): boolean {
  const lowerDetails = details.toLowerCase();
  return lowerDetails.includes("0x1788") ||
         lowerDetails.includes("custom program error: 6024") ||
         (lowerDetails.includes("fee") && lowerDetails.includes("account") && lowerDetails.includes("error"));
}

async function executeSwapBuild(url: string, body: Record<string, any>): Promise<BuildResult> {
  try {
    const response = await fetchJupiterWithRetry(
      swapConfig.jupiterSwapPath,
      {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Cordon-Wallet/1.0",
        },
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
  referralConfigured: boolean;
  forceDisabled: boolean;
} {
  return {
    enabled: platformFeesAllowed(),
    feeBps: platformFeeConfig.feeBps,
    referralConfigured: platformFeeConfig.referralAccount.length > 0,
    forceDisabled: FORCE_DISABLE_JUPITER_PLATFORM_FEES,
  };
}
