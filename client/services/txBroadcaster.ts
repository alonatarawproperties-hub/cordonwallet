import {
  Connection,
  VersionedTransaction,
  TransactionSignature,
  Commitment,
  SignatureStatus,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  RPC_PRIMARY,
  RPC_FALLBACK,
  WS_PRIMARY,
  WS_FALLBACK,
  SwapSpeed,
  SPEED_CONFIGS,
  JITO_ENDPOINTS,
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

// ---------------------------------------------------------------------------
// Jito Block Engine — bundle submission
// ---------------------------------------------------------------------------
// Jito bundles execute atomically: ALL transactions succeed or NONE land.
// By including a tip transaction that pays a Jito validator, we get priority
// in the block auction. ~95% of validators run the Jito client.

async function sendJitoBundle(
  endpoint: string,
  bundle: string[], // base58-encoded serialized transactions
): Promise<{ bundleId?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${endpoint}/api/v1/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [bundle],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json();

    if (data.result) return { bundleId: data.result };
    if (data.error) return { error: data.error.message || JSON.stringify(data.error) };
    return { error: "No result from Jito" };
  } catch (err: any) {
    return { error: err.name === "AbortError" ? "Jito timeout" : err.message };
  }
}

// Fallback: send single tx via Jito sendTransaction (no bundle, no tip needed)
async function sendViaJito(
  signedTx: Uint8Array
): Promise<{ signature?: string; error?: string }> {
  try {
    const base64Tx = Buffer.from(signedTx).toString("base64");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${JITO_ENDPOINTS[0]}/api/v1/transactions`, {
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

    if (data.result) return { signature: data.result };
    if (data.error) return { error: data.error.message || JSON.stringify(data.error) };
    return { error: "No result from Jito" };
  } catch (err: any) {
    return { error: err.name === "AbortError" ? "Jito timeout" : err.message };
  }
}

// ---------------------------------------------------------------------------
// Main broadcast function
// ---------------------------------------------------------------------------

export async function broadcastTransaction(
  signedTxBytes: Uint8Array,
  config: BroadcastConfig,
  jitoTipTxBytes?: Uint8Array,
): Promise<BroadcastResult> {
  const speedConfig = SPEED_CONFIGS[config.mode];
  const primaryConn = getPrimaryConnection();
  const fallbackConn = getFallbackConnection();

  let rebroadcastCount = 0;
  const startTime = Date.now();

  // Precompute signature from the signed bytes (compact-u16 count + 64-byte sig)
  const signature = bs58.encode(signedTxBytes.slice(1, 65));
  const swapBase58 = bs58.encode(signedTxBytes);

  // Pre-encode tip tx for Jito bundles
  let tipBase58: string | undefined;
  let bundle: string[] | undefined;
  if (jitoTipTxBytes) {
    tipBase58 = bs58.encode(jitoTipTxBytes);
    // Tip tx first (pays from pre-swap balance), then swap tx
    bundle = [tipBase58, swapBase58];
  }

  // ---------------------------------------------------------------------------
  // Phase 1: BLAST to every endpoint simultaneously (fire & forget)
  // This is how every fast TG bot works — fire to all paths at once,
  // first one to reach a validator wins.
  // ---------------------------------------------------------------------------

  // Path A: Jito bundle (highest priority — has tip)
  if (bundle) {
    for (const ep of JITO_ENDPOINTS) {
      sendJitoBundle(ep, bundle)
        .then(r => {
          if (r.bundleId) console.log(`[Broadcaster] Jito bundle accepted (${ep}): ${r.bundleId}`);
          else console.log(`[Broadcaster] Jito bundle rejected (${ep}): ${r.error}`);
        })
        .catch(() => {});
    }
  }

  // Path B: Jito sendTransaction (no bundle, backup)
  sendViaJito(signedTxBytes)
    .then(r => console.log(`[Broadcaster] Jito sendTx: ${r.signature || r.error}`))
    .catch(() => {});

  // Path C: Regular RPCs (backup — works if Jito endpoints are down)
  primaryConn.sendRawTransaction(signedTxBytes, {
    skipPreflight: true,
    preflightCommitment: "confirmed",
    maxRetries: 0,
  })
    .then(sig => console.log(`[Broadcaster] Primary RPC: ${sig}`))
    .catch(err => console.log(`[Broadcaster] Primary RPC failed: ${err.message}`));

  fallbackConn.sendRawTransaction(signedTxBytes, {
    skipPreflight: true,
    preflightCommitment: "confirmed",
    maxRetries: 0,
  })
    .then(sig => console.log(`[Broadcaster] Fallback RPC: ${sig}`))
    .catch(err => console.log(`[Broadcaster] Fallback RPC failed: ${err.message}`));

  config.onStatusChange?.("submitted", signature);

  // ---------------------------------------------------------------------------
  // Phase 2: Single polling loop — check status + rebroadcast periodically
  // ---------------------------------------------------------------------------
  const maxDuration = config.maxWaitMs ?? speedConfig.maxRebroadcastDurationMs;
  const pollIntervalMs = 400;
  const rebroadcastIntervalMs = speedConfig.rebroadcastIntervalMs;
  let lastRebroadcastAt = startTime;

  while (Date.now() - startTime < maxDuration) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    // Poll confirmation status
    try {
      const response = await primaryConn.getSignatureStatus(signature, {
        searchTransactionHistory: false,
      });
      const status = response.value;

      // On-chain error (slippage, insufficient funds, etc.)
      if (status?.err) {
        const errorStr = JSON.stringify(status.err);
        return {
          signature,
          status: "failed",
          error: formatOnchainError(errorStr),
          slot: status.slot ?? undefined,
          rebroadcastCount,
          usedFallback: false,
        };
      }

      // Check confirmation level
      const confStatus = status?.confirmationStatus as string | undefined;
      if (confStatus === "finalized" || confStatus === "confirmed" || confStatus === "processed") {
        const finalStatus: TxStatus = confStatus === "finalized" ? "finalized"
          : confStatus === "confirmed" ? "confirmed" : "processed";
        config.onStatusChange?.(finalStatus, signature);
        return {
          signature,
          status: finalStatus,
          slot: status?.slot ?? undefined,
          confirmationTime: Date.now() - startTime,
          rebroadcastCount,
          usedFallback: false,
        };
      }
    } catch (err) {
      // Status check failed — try fallback for next poll
      try {
        const fb = await fallbackConn.getSignatureStatus(signature, {
          searchTransactionHistory: false,
        });
        const status = fb.value;
        if (status?.err) {
          return {
            signature,
            status: "failed",
            error: formatOnchainError(JSON.stringify(status.err)),
            slot: status.slot ?? undefined,
            rebroadcastCount,
            usedFallback: true,
          };
        }
        const confStatus = status?.confirmationStatus as string | undefined;
        if (confStatus === "finalized" || confStatus === "confirmed" || confStatus === "processed") {
          const finalStatus: TxStatus = confStatus === "finalized" ? "finalized"
            : confStatus === "confirmed" ? "confirmed" : "processed";
          config.onStatusChange?.(finalStatus, signature);
          return {
            signature,
            status: finalStatus,
            slot: status?.slot ?? undefined,
            confirmationTime: Date.now() - startTime,
            rebroadcastCount,
            usedFallback: true,
          };
        }
      } catch (_) { /* both failed, keep polling */ }
    }

    // Rebroadcast on schedule
    if (Date.now() - lastRebroadcastAt >= rebroadcastIntervalMs) {
      lastRebroadcastAt = Date.now();
      rebroadcastCount++;
      config.onRebroadcast?.(rebroadcastCount);

      // Re-send Jito bundle to 2 random endpoints
      if (bundle) {
        const shuffled = [...JITO_ENDPOINTS].sort(() => Math.random() - 0.5);
        sendJitoBundle(shuffled[0], bundle).catch(() => {});
        if (shuffled[1]) sendJitoBundle(shuffled[1], bundle).catch(() => {});
      }

      // Re-send via Jito sendTransaction + primary RPC
      sendViaJito(signedTxBytes).catch(() => {});
      primaryConn.sendRawTransaction(signedTxBytes, {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        maxRetries: 0,
      }).catch(() => {});

      // Hit fallback RPC on turbo or every other rebroadcast
      if (config.mode === "turbo" || rebroadcastCount % 2 === 0) {
        fallbackConn.sendRawTransaction(signedTxBytes, {
          skipPreflight: true,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        }).catch(() => {});
      }

      console.log(`[Broadcaster] Rebroadcast #${rebroadcastCount} (Jito bundle + RPCs)`);
    }
  }

  // Timed out — tx may still land
  return {
    signature,
    status: "expired",
    error: "Transaction not confirmed in time. It may still land - check explorer.",
    rebroadcastCount,
    usedFallback: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatOnchainError(errorStr: string): string {
  if (errorStr.includes("SlippageToleranceExceeded") || errorStr.includes("0x1771")) {
    return "Slippage tolerance exceeded. Please retry with higher slippage.";
  }
  if (errorStr.includes("InsufficientFunds") || errorStr.includes("0x1")) {
    return "Insufficient funds for this swap.";
  }
  if (errorStr.includes("blockhash") || errorStr.includes("expired")) {
    return "Transaction expired. Please retry.";
  }
  return `Transaction failed: ${errorStr}`;
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
