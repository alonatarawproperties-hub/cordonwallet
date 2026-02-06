import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { swapConfig, getPriorityFeeCap, SpeedMode, CORDON_TREASURY_WALLET, CORDON_SUCCESS_FEE_BPS, platformFeeConfig, isPlatformFeeEnabled } from "./config";
import type { QuoteResult, BuildResult } from "./types";

// Platform fee enabled flag - controlled by config/env
export function platformFeesAllowed(): boolean {
  return isPlatformFeeEnabled();
}

// Log once at module load
console.log("[JupiterFee] platformFeesAllowed:", platformFeesAllowed(), "treasury:", CORDON_TREASURY_WALLET.slice(0, 8) + "...");

const NATIVE_SOL_MINT = "11111111111111111111111111111111";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

function normalizeToWsol(mint: string): string {
  if (mint === NATIVE_SOL_MINT || mint.toLowerCase() === "sol") {
    return WSOL_MINT;
  }
  return mint;
}

// Derive fee account as a simple ATA of the treasury wallet for the given mint.
// No referral program needed - Jupiter Metis API accepts any valid token account.
function deriveFeeAccountAta(mint: string): string | null {
  try {
    const treasuryPubkey = new PublicKey(CORDON_TREASURY_WALLET);
    const mintPubkey = new PublicKey(mint);
    const ata = getAssociatedTokenAddressSync(mintPubkey, treasuryPubkey);
    return ata.toBase58();
  } catch (err: any) {
    console.warn(`[SwapFee] Failed to derive treasury ATA: ${err.message}`);
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

  if (!platformFeesAllowed()) {
    return { params: null, reason: "Platform fee disabled by config", outputMint, normalizedMint };
  }

  console.log(`[SwapFee] getPlatformFeeParams: outputMint=${outputMint.slice(0, 8)}..., normalizedMint=${normalizedMint.slice(0, 8)}...`);

  // Check known (pre-verified) fee accounts first
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

  // Derive treasury ATA for this mint
  const ataAddress = deriveFeeAccountAta(normalizedMint);
  if (!ataAddress) {
    console.log(`[SwapFee] Could not derive ATA for ${normalizedMint.slice(0, 8)}... Fee OFF.`);
    return { params: null, reason: "ATA derivation failed", outputMint, normalizedMint };
  }

  console.log(`[SwapFee] Derived treasury ATA=${ataAddress.slice(0, 8)}... for ${normalizedMint.slice(0, 8)}...`);

  // Verify the ATA exists on-chain before using it
  try {
    const connection = new Connection(swapConfig.solanaRpcUrl, { commitment: "confirmed" });
    const accountInfo = await Promise.race([
      connection.getAccountInfo(new PublicKey(ataAddress)),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);

    if (accountInfo) {
      console.log(`[SwapFee] Treasury ATA EXISTS for ${normalizedMint.slice(0, 8)}..., applying ${platformFeeConfig.feeBps}bps`);
      return {
        params: { feeAccount: ataAddress, feeBps: platformFeeConfig.feeBps },
        reason: "Verified on-chain",
        outputMint,
        normalizedMint,
      };
    } else {
      console.log(`[SwapFee] Treasury ATA NOT FOUND for ${normalizedMint.slice(0, 8)}... Fee OFF for this mint.`);
      return { params: null, reason: "Treasury ATA not initialized for this mint", outputMint, normalizedMint };
    }
  } catch (err: any) {
    console.warn(`[SwapFee] ATA verification error: ${err.message}. Fee OFF.`);
    return { params: null, reason: `Verification error: ${err.message}`, outputMint, normalizedMint };
  }
}

async function resolvePlatformFeeAccount(
  outputMint: string,
  inputMint: string,
  swapMode: string
): Promise<FeeAccountResult> {
  if (!platformFeesAllowed()) {
    return { feeAccount: null, feeBps: 0, reason: "Platform fees disabled" };
  }

  // ExactIn: fee on output mint. ExactOut: fee on input mint.
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
  const { inputMint, outputMint, amount, slippageBps, swapMode, includePlatformFee = true } = params;

  const queryParams = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: slippageBps.toString(),
    swapMode,
  });

  // Add platformFeeBps when fees are enabled
  if (includePlatformFee && platformFeesAllowed()) {
    queryParams.set("platformFeeBps", platformFeeConfig.feeBps.toString());
    console.log("[SwapFee] Adding platformFeeBps to quote:", platformFeeConfig.feeBps);
  }

  const url = `${swapConfig.jupiterBaseUrl}${swapConfig.jupiterQuotePath}?${queryParams.toString()}`;
  console.log("[Jupiter] Quote request:", url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), swapConfig.jupiterTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Cordon-Wallet/1.0",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

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
    clearTimeout(timeout);

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

  // Determine if output is SOL/WSOL - requires special handling
  const outputMint = quote?.outputMint || "";
  const inputMint = quote?.inputMint || "";
  const swapMode = quote?.swapMode || "ExactIn";
  const isSolOutput = outputMint === WSOL_MINT;

  // For SOL output: MUST use wrapAndUnwrapSol=true
  const effectiveWrapAndUnwrapSol = isSolOutput ? true : params.wrapAndUnwrapSol;

  const url = `${swapConfig.jupiterBaseUrl}${swapConfig.jupiterSwapPath}`;

  // Resolve platform fee account (treasury ATA for the fee mint)
  let feeAccount: string | null = null;
  let feeReason = "disabled";

  if (platformFeesAllowed() && !params.disablePlatformFee) {
    const feeResult = await resolvePlatformFeeAccount(outputMint, inputMint, swapMode);
    feeAccount = feeResult.feeAccount;
    feeReason = feeResult.reason;
  }

  // Build swap body
  const body: Record<string, any> = {
    quoteResponse: quote,
    userPublicKey,
    wrapAndUnwrapSol: effectiveWrapAndUnwrapSol,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: priorityFeeCap,
  };

  // Include feeAccount if resolved successfully
  if (feeAccount) {
    body.feeAccount = feeAccount;
  }

  console.log("[JUP_SWAP_DEBUG]", JSON.stringify({
    outputMint: outputMint.slice(0, 8) + "...",
    isSolOutput,
    wrapAndUnwrapSol: effectiveWrapAndUnwrapSol,
    hasFeeAccount: !!feeAccount,
    feeReason,
    feeBps: feeAccount ? platformFeeConfig.feeBps : 0,
  }));

  console.log("[Jupiter] Build swap:", {
    user: userPublicKey.slice(0, 8) + "...",
    speedMode,
    priorityFeeCap,
    platformFee: feeAccount ? `${platformFeeConfig.feeBps}bps -> ${feeAccount.slice(0, 8)}...` : "OFF",
  });

  const result = await executeSwapBuild(url, body);

  // Retry logic for 0x1788 error - retry WITHOUT fee account
  if (!result.ok && result.details && isFeeAccountError(result.details)) {
    console.warn("[SwapFee] 0x1788 detected – retrying without fee account");

    // Fetch a fresh quote without platformFeeBps
    const freshQuoteResult = await getQuote({
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      amount: quote.inAmount,
      slippageBps: quote.slippageBps || 50,
      swapMode: quote.swapMode || "ExactIn",
      includePlatformFee: false,
    });

    if (!freshQuoteResult.ok) {
      console.error("[SwapFee] Fresh quote fetch failed:", freshQuoteResult.message);
      return result;
    }

    const freshOutputMint = freshQuoteResult.quote?.outputMint || "";
    const freshIsSolOutput = freshOutputMint === WSOL_MINT;
    const retryBody = {
      quoteResponse: freshQuoteResult.quote,
      userPublicKey,
      wrapAndUnwrapSol: freshIsSolOutput ? true : params.wrapAndUnwrapSol,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: priorityFeeCap,
      // NO feeAccount on retry
    };

    const retryResult = await executeSwapBuild(url, retryBody);
    if (retryResult.ok) {
      console.log("[SwapFee] Retry without fee succeeded.");
      return {
        ...retryResult,
        feeDisabledReason: "Fee account error (0x1788), executed without fee",
      };
    }
    return retryResult;
  }

  return result;
}

function isFeeAccountError(details: string): boolean {
  const lowerDetails = details.toLowerCase();
  return lowerDetails.includes("0x1788") ||
         lowerDetails.includes("custom program error: 6024") ||
         (lowerDetails.includes("fee") && lowerDetails.includes("account") && lowerDetails.includes("error"));
}

async function executeSwapBuild(url: string, body: Record<string, any>): Promise<BuildResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), swapConfig.jupiterTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Cordon-Wallet/1.0",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

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
    clearTimeout(timeout);

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
  treasuryWallet: string;
} {
  return {
    enabled: platformFeesAllowed(),
    feeBps: platformFeeConfig.feeBps,
    treasuryWallet: CORDON_TREASURY_WALLET,
  };
}
