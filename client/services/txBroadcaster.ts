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
}

interface RpcHealth {
  url: string;
  latencyMs: number | null;
  healthy: boolean;
  lastCheck: number;
}

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
  
  const skipPreflight = config.skipPreflight ?? true; // Default to skip for DEX swaps
  
  try {
    config.onStatusChange?.("submitted", "");

    // Send to both RPCs in parallel for fastest landing
    const primaryPromise = sendWithRetry(primaryConn, signedTxBytes, 3, skipPreflight)
      .catch((e: any) => ({ error: e }));
    const fallbackPromise = sendWithRetry(fallbackConn, signedTxBytes, 2, skipPreflight)
      .catch((e: any) => ({ error: e }));

    const [primaryResult, fallbackResult] = await Promise.all([primaryPromise, fallbackPromise]);

    if (typeof primaryResult === "string") {
      signature = primaryResult;
      usedFallback = false;
      console.log(`[Broadcaster] Primary submit: ${signature}${skipPreflight ? " (preflight skipped)" : ""}`);
    } else if (typeof fallbackResult === "string") {
      signature = fallbackResult;
      usedFallback = true;
      console.log(`[Broadcaster] Fallback submit: ${signature}`);
    } else {
      // Both failed
      const error = (primaryResult as any).error || (fallbackResult as any).error;
      return {
        signature: "",
        status: "failed",
        error: error?.message || "Failed to submit transaction",
        rebroadcastCount: 0,
        usedFallback: true,
      };
    }

    // If fallback also succeeded, mark it
    if (typeof primaryResult === "string" && typeof fallbackResult === "string") {
      usedFallback = true;
      console.log("[Broadcaster] Submitted to both RPCs in parallel");
    }

    config.onStatusChange?.("submitted", signature);
  } catch (submitError: any) {
    return {
      signature: "",
      status: "failed",
      error: submitError.message || "Failed to submit transaction",
      rebroadcastCount: 0,
      usedFallback: false,
    };
  }
  
  // Quick initial status check - don't block long, rebroadcast loop handles retries
  const initialCheck = await waitForStatus(primaryConn, signature, "processed", 300);
  if (initialCheck.status?.err) {
    return {
      signature,
      status: "failed",
      error: JSON.stringify(initialCheck.status.err),
      rebroadcastCount,
      usedFallback,
    };
  }
  
  let rebroadcastDone = false;

  const rebroadcastLoop = async () => {
    const maxDuration = speedConfig.maxRebroadcastDurationMs;
    const interval = speedConfig.rebroadcastIntervalMs;
    const loopStart = Date.now();

    while (Date.now() - loopStart < maxDuration && !rebroadcastDone) {
      await new Promise(r => setTimeout(r, interval));

      if (rebroadcastDone) return;

      rebroadcastCount++;

      // Fire rebroadcasts to both RPCs in parallel - don't wait for status check
      const sends: Promise<void>[] = [
        primaryConn.sendRawTransaction(signedTxBytes, {
          skipPreflight: true,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        }).then(() => { console.log(`[Broadcaster] Rebroadcast ${rebroadcastCount} (primary)`); }).catch(() => {}),
        fallbackConn.sendRawTransaction(signedTxBytes, {
          skipPreflight: true,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        }).then(() => { console.log(`[Broadcaster] Rebroadcast ${rebroadcastCount} (fallback)`); }).catch(() => {}),
      ];

      await Promise.all(sends);
    }
  };

  rebroadcastLoop().catch(console.error);
  
  const targetCommitment = speedConfig.completionLevel === "confirmed" ? "confirmed" : "processed";
  const waitTimeout = speedConfig.maxRebroadcastDurationMs + 3000;

  const result = await waitForStatus(primaryConn, signature, targetCommitment, waitTimeout);
  rebroadcastDone = true;

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
