import {
  Connection,
  VersionedTransaction,
  TransactionSignature,
  Commitment,
  SignatureStatus,
} from "@solana/web3.js";
import {
  RPC_PRIMARY,
  RPC_FALLBACK,
  WS_PRIMARY,
  WS_FALLBACK,
  SwapSpeed,
  SPEED_CONFIGS,
} from "@/constants/solanaSwap";

export type TxStatus = "submitted" | "processed" | "confirmed" | "finalized" | "failed" | "expired";

export interface BroadcastResult {
  signature: string;
  status: TxStatus;
  error?: string;
  slot?: number;
  confirmationTime?: number;
  rebroadcastCount: number;
  usedFallback: boolean;
}

export interface BroadcastConfig {
  mode: SwapSpeed;
  onStatusChange?: (status: TxStatus, signature: string) => void;
  onRebroadcast?: (count: number) => void;
  skipPreflight?: boolean;
  /** Override the max wait duration (ms). */
  maxWaitMs?: number;
}

interface RpcHealth {
  url: string;
  latencyMs: number | null;
  healthy: boolean;
  lastCheck: number;
}

// Jito Block Engine endpoints — sends tx directly to validators with MEV
// protection. This is what every fast trading bot uses. ~95% of Solana
// validators run the Jito client so coverage is near-universal.
const JITO_BLOCK_ENGINE = "https://mainnet.block-engine.jito.wtf/api/v1/transactions";

let primaryConnection: Connection | null = null;
let fallbackConnection: Connection | null = null;
let rpcHealthCache: { primary: RpcHealth; fallback: RpcHealth } = {
  primary: { url: RPC_PRIMARY, latencyMs: null, healthy: true, lastCheck: 0 },
  fallback: { url: RPC_FALLBACK, latencyMs: null, healthy: true, lastCheck: 0 },
};

function getPrimaryConnection(): Connection {
  if (!primaryConnection) {
    primaryConnection = new Connection(RPC_PRIMARY, {
      commitment: "confirmed",
      wsEndpoint: WS_PRIMARY || undefined,
    });
  }
  return primaryConnection;
}

function getFallbackConnection(): Connection {
  if (!fallbackConnection) {
    fallbackConnection = new Connection(RPC_FALLBACK, {
      commitment: "confirmed",
      wsEndpoint: WS_FALLBACK || undefined,
    });
  }
  return fallbackConnection;
}

export async function checkRpcHealth(): Promise<typeof rpcHealthCache> {
  const checkConnection = async (conn: Connection, key: "primary" | "fallback"): Promise<void> => {
    const start = Date.now();
    try {
      await conn.getLatestBlockhash({ commitment: "confirmed" });
      rpcHealthCache[key] = {
        url: key === "primary" ? RPC_PRIMARY : RPC_FALLBACK,
        latencyMs: Date.now() - start,
        healthy: true,
        lastCheck: Date.now(),
      };
    } catch (error) {
      rpcHealthCache[key] = {
        url: key === "primary" ? RPC_PRIMARY : RPC_FALLBACK,
        latencyMs: null,
        healthy: false,
        lastCheck: Date.now(),
      };
    }
  };

  await Promise.all([
    checkConnection(getPrimaryConnection(), "primary"),
    checkConnection(getFallbackConnection(), "fallback"),
  ]);

  return rpcHealthCache;
}

export function getRpcHealth(): typeof rpcHealthCache {
  return rpcHealthCache;
}

// --- Jito Block Engine submission ---
// Sends directly to Jito's block engine which forwards to validators via
// staked connections. This bypasses the standard RPC mempool and gives
// MEV protection + much higher landing rates.
async function sendViaJito(
  signedTx: Uint8Array
): Promise<{ signature?: string; error?: string }> {
  try {
    const base64Tx = Buffer.from(signedTx).toString("base64");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(JITO_BLOCK_ENGINE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [
          base64Tx,
          { encoding: "base64" },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json();

    if (data.result) {
      return { signature: data.result };
    }
    if (data.error) {
      return { error: data.error.message || JSON.stringify(data.error) };
    }
    return { error: "No result from Jito" };
  } catch (err: any) {
    return { error: err.name === "AbortError" ? "Jito timeout" : err.message };
  }
}

async function sendWithRetry(
  connection: Connection,
  signedTx: Uint8Array,
  maxRetries: number = 3,
  skipPreflight: boolean = false
): Promise<TransactionSignature> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const signature = await connection.sendRawTransaction(signedTx, {
        skipPreflight,
        preflightCommitment: "confirmed",
        maxRetries: 0,
      });
      return signature;
    } catch (error: any) {
      lastError = error;
      // Don't retry blockhash/expired errors - they need a fresh transaction
      if (error.message?.includes("blockhash") ||
          error.message?.includes("not found") ||
          error.message?.includes("expired")) {
        throw error;
      }
      // Don't retry 0x1788 errors when preflight is enabled - let caller handle
      if (error.message?.includes("0x1788")) {
        throw error;
      }
      await new Promise(r => setTimeout(r, 100 * (i + 1)));
    }
  }

  throw lastError || new Error("Failed to send transaction");
}

async function waitForStatus(
  connection: Connection,
  signature: string,
  targetStatus: Commitment,
  timeoutMs: number
): Promise<{ status: SignatureStatus | null; confirmed: boolean }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: false,
      });

      const status = response.value;

      if (status?.err) {
        return { status, confirmed: false };
      }

      const confStatus = status?.confirmationStatus as string | undefined;

      if (confStatus === "finalized") {
        return { status, confirmed: true };
      }

      if (targetStatus === "confirmed") {
        if (confStatus === "confirmed" || confStatus === "finalized") {
          return { status, confirmed: true };
        }
      }

      if (targetStatus === "processed" && confStatus) {
        return { status, confirmed: true };
      }
    } catch (error) {
      console.warn("[Broadcaster] Status check error:", error);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  return { status: null, confirmed: false };
}

export async function broadcastTransaction(
  signedTxBytes: Uint8Array,
  config: BroadcastConfig
): Promise<BroadcastResult> {
  const speedConfig = SPEED_CONFIGS[config.mode];
  const primaryConn = getPrimaryConnection();
  const fallbackConn = getFallbackConnection();

  let signature: string = "";
  let usedFallback = false;
  let rebroadcastCount = 0;
  const startTime = Date.now();

  // Always skip preflight for speed — Jito handles this better anyway
  const skipPreflight = config.skipPreflight ?? true;

  // --- Phase 1: Blast tx to Jito + all RPCs simultaneously ---
  // This is how fast TG bots work. Fire to every endpoint at once,
  // take the first signature that comes back.
  config.onStatusChange?.("submitted", "");

  const jitoPromise = sendViaJito(signedTxBytes);
  const primaryPromise = sendWithRetry(primaryConn, signedTxBytes, 2, skipPreflight)
    .then(sig => ({ signature: sig, error: undefined }))
    .catch(err => ({ signature: undefined, error: err.message }));
  const fallbackPromise = sendWithRetry(fallbackConn, signedTxBytes, 1, skipPreflight)
    .then(sig => ({ signature: sig, error: undefined }))
    .catch(err => ({ signature: undefined, error: err.message }));

  // Wait for all submissions to complete (they run in parallel)
  const [jitoResult, primaryResult, fallbackResult] = await Promise.all([
    jitoPromise,
    primaryPromise,
    fallbackPromise,
  ]);

  // Take the first valid signature
  if (jitoResult.signature) {
    signature = jitoResult.signature;
    console.log(`[Broadcaster] Jito submit: ${signature}`);
  } else if (primaryResult.signature) {
    signature = primaryResult.signature;
    console.log(`[Broadcaster] Primary submit: ${signature}`);
  } else if (fallbackResult.signature) {
    signature = fallbackResult.signature;
    usedFallback = true;
    console.log(`[Broadcaster] Fallback submit: ${signature}`);
  } else {
    // All three failed
    const error = jitoResult.error || primaryResult.error || fallbackResult.error || "All endpoints failed";
    console.error("[Broadcaster] All endpoints failed:", { jito: jitoResult.error, primary: primaryResult.error, fallback: fallbackResult.error });
    return {
      signature: "",
      status: "failed",
      error,
      rebroadcastCount: 0,
      usedFallback: false,
    };
  }

  config.onStatusChange?.("submitted", signature);

  // --- Phase 2: Quick status check ---
  const initialCheck = await waitForStatus(primaryConn, signature, "processed", 500);
  if (initialCheck.status?.err) {
    return {
      signature,
      status: "failed",
      error: JSON.stringify(initialCheck.status.err),
      rebroadcastCount,
      usedFallback,
    };
  }

  if (initialCheck.confirmed) {
    const confStatus = initialCheck.status?.confirmationStatus as string | undefined;
    const earlyStatus: TxStatus = confStatus === "finalized" ? "finalized"
      : confStatus === "confirmed" ? "confirmed" : "processed";
    config.onStatusChange?.(earlyStatus, signature);
    return {
      signature,
      status: earlyStatus,
      slot: initialCheck.status?.slot ?? undefined,
      confirmationTime: Date.now() - startTime,
      rebroadcastCount,
      usedFallback,
    };
  }

  // --- Phase 3: Rebroadcast loop (Jito + RPCs) ---
  const rebroadcastLoop = async () => {
    const maxDuration = config.maxWaitMs
      ? Math.min(config.maxWaitMs, speedConfig.maxRebroadcastDurationMs)
      : speedConfig.maxRebroadcastDurationMs;
    const interval = speedConfig.rebroadcastIntervalMs;
    const loopStart = Date.now();

    while (Date.now() - loopStart < maxDuration) {
      await new Promise(r => setTimeout(r, interval));

      const status = await waitForStatus(primaryConn, signature, "processed", 300);
      if (status.confirmed || status.status?.err) {
        return;
      }

      rebroadcastCount++;
      config.onRebroadcast?.(rebroadcastCount);

      // Rebroadcast to Jito + primary simultaneously
      sendViaJito(signedTxBytes).catch(() => {});
      primaryConn.sendRawTransaction(signedTxBytes, {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        maxRetries: 0,
      }).catch(() => {});

      console.log(`[Broadcaster] Rebroadcast ${rebroadcastCount} (Jito + primary)`);

      if (config.mode === "turbo" || rebroadcastCount % 2 === 0) {
        fallbackConn.sendRawTransaction(signedTxBytes, {
          skipPreflight: true,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        }).catch(() => {});
      }
    }
  };

  rebroadcastLoop().catch(console.error);

  const targetCommitment = speedConfig.completionLevel === "confirmed" ? "confirmed" : "processed";
  const waitTimeout = config.maxWaitMs ?? (speedConfig.maxRebroadcastDurationMs + 5000);

  const result = await waitForStatus(primaryConn, signature, targetCommitment, waitTimeout);

  if (result.status?.err) {
    const errorStr = JSON.stringify(result.status.err);

    let errorCategory = "unknown";
    if (errorStr.includes("SlippageToleranceExceeded") || errorStr.includes("0x1771")) {
      errorCategory = "slippage";
    } else if (errorStr.includes("InsufficientFunds") || errorStr.includes("0x1")) {
      errorCategory = "insufficient_funds";
    } else if (errorStr.includes("blockhash") || errorStr.includes("expired")) {
      errorCategory = "blockhash_expired";
    }

    return {
      signature,
      status: "failed",
      error: errorCategory === "slippage"
        ? "Slippage tolerance exceeded. Please retry with higher slippage."
        : errorCategory === "insufficient_funds"
        ? "Insufficient funds for this swap."
        : errorCategory === "blockhash_expired"
        ? "Transaction expired. Please retry."
        : `Transaction failed: ${errorStr}`,
      slot: result.status.slot ?? undefined,
      rebroadcastCount,
      usedFallback,
    };
  }

  if (!result.confirmed) {
    return {
      signature,
      status: "expired",
      error: "Transaction not confirmed in time. It may still land - check explorer.",
      rebroadcastCount,
      usedFallback,
    };
  }

  const confirmationTime = Date.now() - startTime;
  const finalStatus: TxStatus = result.status?.confirmationStatus === "finalized"
    ? "finalized"
    : result.status?.confirmationStatus === "confirmed"
    ? "confirmed"
    : "processed";

  config.onStatusChange?.(finalStatus, signature);

  return {
    signature,
    status: finalStatus,
    slot: result.status?.slot ?? undefined,
    confirmationTime,
    rebroadcastCount,
    usedFallback,
  };
}

export function classifyError(error: string): {
  category: "slippage" | "insufficient_funds" | "blockhash_expired" | "rpc_timeout" | "unknown";
  userMessage: string;
  canRetry: boolean;
  needsRebuild: boolean;
} {
  const errorLower = error.toLowerCase();

  if (errorLower.includes("slippage") || errorLower.includes("0x1771")) {
    return {
      category: "slippage",
      userMessage: "Price moved too much. Increase slippage or try again.",
      canRetry: true,
      needsRebuild: true,
    };
  }

  // Token-2022 compatibility error
  if (errorLower.includes("0x177e") || errorLower.includes("incorrecttokenprogramid")) {
    return {
      category: "unknown",
      userMessage: "This token uses Token-2022 which may have limited swap support. Try a smaller amount or different token.",
      canRetry: true,
      needsRebuild: true,
    };
  }

  // 0x1788 = InvalidAccountData - usually stale route data, pool state changed, or insufficient SOL for WSOL rent
  if (errorLower.includes("0x1788") || errorLower.includes("invalidaccountdata")) {
    return {
      category: "blockhash_expired",
      userMessage: "Swap route expired or needs more SOL for fees/rent. Add ~0.005 SOL and try again.",
      canRetry: true,
      needsRebuild: true,
    };
  }

  // Be specific about insufficient funds - 0x1 by itself (word boundary) or explicit text
  // Also handle lamports-related errors which indicate SOL fee issues
  if (errorLower.includes("insufficient lamports") ||
      errorLower.includes("insufficient sol") ||
      errorLower.includes("not enough sol")) {
    return {
      category: "insufficient_funds",
      userMessage: "Not enough SOL to cover network fees and temporary account rent. Add SOL and try again.",
      canRetry: false,
      needsRebuild: false,
    };
  }

  if (errorLower.includes("insufficient") ||
      /\b0x1\b/.test(errorLower) ||
      errorLower.includes("custom program error: 0x1\"") ||
      errorLower.includes("custom program error: 1\"")) {
    return {
      category: "insufficient_funds",
      userMessage: "Not enough balance for this swap.",
      canRetry: false,
      needsRebuild: false,
    };
  }

  if (errorLower.includes("blockhash") || errorLower.includes("expired") || errorLower.includes("not found")) {
    return {
      category: "blockhash_expired",
      userMessage: "Transaction expired. Please try again.",
      canRetry: true,
      needsRebuild: true,
    };
  }

  if (errorLower.includes("timeout") || errorLower.includes("econnrefused")) {
    return {
      category: "rpc_timeout",
      userMessage: "Network issue. Retrying...",
      canRetry: true,
      needsRebuild: false,
    };
  }

  return {
    category: "unknown",
    userMessage: error,
    canRetry: false,
    needsRebuild: false,
  };
}

export function getExplorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}
