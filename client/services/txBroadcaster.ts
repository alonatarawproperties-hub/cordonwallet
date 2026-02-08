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
  /** Override the max wait duration (ms). Useful for Pump.fun txs that land in
   *  ~5s or not at all — avoids making the user wait 30+ seconds. */
  maxWaitMs?: number;
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

  // --- Phase 1: Submit to RPCs ---
  try {
    config.onStatusChange?.("submitted", "");
    signature = await sendWithRetry(primaryConn, signedTxBytes, 3, skipPreflight);
    config.onStatusChange?.("submitted", signature);
    console.log(`[Broadcaster] Primary submit: ${signature}${skipPreflight ? " (preflight skipped)" : ""}`);
  } catch (primaryError: any) {
    console.warn("[Broadcaster] Primary submit failed, trying fallback:", primaryError.message);

    try {
      signature = await sendWithRetry(fallbackConn, signedTxBytes, 3, skipPreflight);
      usedFallback = true;
      config.onStatusChange?.("submitted", signature);
      console.log(`[Broadcaster] Fallback submit: ${signature}`);
    } catch (fallbackError: any) {
      return {
        signature: "",
        status: "failed",
        error: fallbackError.message || "Failed to submit transaction",
        rebroadcastCount: 0,
        usedFallback: true,
      };
    }
  }

  // --- Phase 2: Early failure detection ---
  // Check status quickly. If the tx already errored on-chain, return immediately
  // instead of waiting the full timeout.
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

  // If already confirmed in the initial check, return immediately
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

  // Also send to fallback for redundancy if primary succeeded
  if (!usedFallback) {
    try {
      await sendWithRetry(fallbackConn, signedTxBytes, 1);
      usedFallback = true;
      console.log("[Broadcaster] Also sent to fallback for redundancy");
    } catch {
    }
  }

  // --- Phase 3: Simulate to detect doomed transactions early ---
  // If skipPreflight was used, run a simulation now to catch errors that would
  // cause the tx to be silently dropped (expired blockhash, program errors).
  // This avoids waiting 30+ seconds for a tx that will never land.
  if (skipPreflight) {
    try {
      const simResult = await primaryConn.simulateTransaction(
        VersionedTransaction.deserialize(signedTxBytes),
        { commitment: "confirmed", replaceRecentBlockhash: false }
      );
      if (simResult.value.err) {
        const simError = JSON.stringify(simResult.value.err);
        console.warn("[Broadcaster] Simulation failed, tx is doomed:", simError);
        return {
          signature,
          status: "failed",
          error: simError,
          rebroadcastCount,
          usedFallback,
        };
      }
      console.log("[Broadcaster] Simulation passed, tx should land");
    } catch (simErr: any) {
      // Simulation RPC call failed (network issue) - continue waiting normally
      console.warn("[Broadcaster] Simulation check failed (non-fatal):", simErr.message);
    }
  }

  // --- Phase 4: Rebroadcast loop + confirmation wait ---
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

      try {
        await primaryConn.sendRawTransaction(signedTxBytes, {
          skipPreflight: true,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        });
        console.log(`[Broadcaster] Rebroadcast ${rebroadcastCount}`);
      } catch {
      }

      if (config.mode === "turbo" && rebroadcastCount % 2 === 0) {
        try {
          await fallbackConn.sendRawTransaction(signedTxBytes, {
            skipPreflight: true,
            preflightCommitment: "confirmed",
            maxRetries: 0,
          });
        } catch {
        }
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
  
  if (errorLower.includes("blockhash") ||
      errorLower.includes("block height exceeded") ||
      (errorLower.includes("expired") && !errorLower.includes("endpoint"))) {
    return {
      category: "blockhash_expired",
      userMessage: "Transaction expired. Please try again.",
      canRetry: true,
      needsRebuild: true,
    };
  }

  // Endpoint or route not found — show the actual error, don't mask it
  if (errorLower.includes("not found") || errorLower.includes("no route")) {
    return {
      category: "unknown",
      userMessage: error,
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

/**
 * Direct client-to-RPC signature status check.
 * Bypasses the server roundtrip for faster confirmation detection.
 */
export async function checkSignatureDirectly(signature: string): Promise<{
  confirmed: boolean;
  processed: boolean;
  error?: string;
}> {
  try {
    const conn = getPrimaryConnection();
    let response = await conn.getSignatureStatus(signature, {
      searchTransactionHistory: false,
    });
    const status = response.value;
    if (!status) {
      response = await conn.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });
    }
    const resolvedStatus = response.value;
    if (!resolvedStatus) {
      const fallbackConn = getFallbackConnection();
      let fallbackResponse = await fallbackConn.getSignatureStatus(signature, {
        searchTransactionHistory: false,
      });
      if (!fallbackResponse.value) {
        fallbackResponse = await fallbackConn.getSignatureStatus(signature, {
          searchTransactionHistory: true,
        });
      }
      if (!fallbackResponse.value) return { confirmed: false, processed: false };
      if (fallbackResponse.value.err) {
        return { confirmed: false, processed: false, error: JSON.stringify(fallbackResponse.value.err) };
      }
      const fallbackLevel = fallbackResponse.value.confirmationStatus;
      return {
        confirmed: fallbackLevel === "confirmed" || fallbackLevel === "finalized",
        processed: !!fallbackLevel,
      };
    }
    if (resolvedStatus.err) {
      return { confirmed: false, processed: false, error: JSON.stringify(resolvedStatus.err) };
    }
    const level = resolvedStatus.confirmationStatus;
    return {
      confirmed: level === "confirmed" || level === "finalized",
      processed: !!level,
    };
  } catch {
    return { confirmed: false, processed: false };
  }
}

export function getExplorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}
