/**
 * Jito + Multi-RPC instant send with aggressive rebroadcast
 *
 * Fires the signed transaction to Jito block engine AND regular RPCs
 * in parallel, then keeps rebroadcasting every 2 seconds until the
 * blockhash expires (~60s). This is how TG bot snipers land trades fast.
 */

import { swapConfig, SpeedMode } from "./config";
import type { InstantSendResult } from "./types";

const JITO_SEND_URL = `${swapConfig.jitoBlockEngineUrl}/api/v1/transactions`;

// Rebroadcast config per speed mode
const REBROADCAST_CONFIG: Record<SpeedMode, { intervalMs: number; maxDurationMs: number }> = {
  standard: { intervalMs: 2000, maxDurationMs: 30_000 },
  fast:     { intervalMs: 1500, maxDurationMs: 40_000 },
  turbo:    { intervalMs: 1000, maxDurationMs: 50_000 },
};

async function sendToJito(signedTxBase64: string): Promise<string | null> {
  try {
    const txBytes = Buffer.from(signedTxBase64, "base64");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(JITO_SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [
          txBytes.toString("base64"),
          {
            encoding: "base64",
            skipPreflight: true,
            maxRetries: 5,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json();

    if (data.result) {
      console.log("[Jito] Transaction sent:", data.result);
      return data.result;
    }

    if (data.error) {
      console.warn("[Jito] Send error:", data.error.message || JSON.stringify(data.error));
      if (data.error.message?.includes("already been processed") ||
          data.error.message?.includes("AlreadyProcessed")) {
        return data.result || null;
      }
    }

    return null;
  } catch (err: any) {
    console.warn("[Jito] Send failed:", err.message);
    return null;
  }
}

async function sendToRpc(
  rpcUrl: string,
  signedTxBase64: string,
  label: string,
  maxRetries: number = 5
): Promise<string | null> {
  try {
    const txBytes = Buffer.from(signedTxBase64, "base64");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [
          txBytes.toString("base64"),
          {
            encoding: "base64",
            skipPreflight: true,
            preflightCommitment: "confirmed",
            maxRetries,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json();

    if (data.result) {
      console.log(`[${label}] Transaction sent:`, data.result);
      return data.result;
    }

    if (data.error) {
      const msg = data.error.message || JSON.stringify(data.error);
      // Blockhash expired = stop rebroadcasting
      if (msg.includes("Blockhash not found") || msg.includes("block height exceeded")) {
        console.warn(`[${label}] Blockhash expired — stopping`);
        return "BLOCKHASH_EXPIRED";
      }
      if (msg.includes("already been processed") || msg.includes("AlreadyProcessed")) {
        console.log(`[${label}] Already processed — tx landed!`);
        return data.result || "ALREADY_PROCESSED";
      }
      console.warn(`[${label}] Send error:`, msg);
    }

    return null;
  } catch (err: any) {
    console.warn(`[${label}] Send failed:`, err.message);
    return null;
  }
}

/**
 * Check if a transaction is confirmed on-chain.
 */
async function checkConfirmation(rpcUrl: string, signature: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: false }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await response.json();

    const status = data?.result?.value?.[0];
    if (status && !status.err) {
      const level = status.confirmationStatus;
      return level === "confirmed" || level === "finalized" || level === "processed";
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Fire signed transaction to Jito + primary RPC + fallback RPC in parallel,
 * then keep rebroadcasting until confirmed or blockhash expires.
 * Returns the signature immediately after first successful send.
 */
export async function instantSend(params: {
  signedTransactionBase64: string;
  speedMode: SpeedMode;
}): Promise<InstantSendResult> {
  const { signedTransactionBase64, speedMode } = params;
  const sentVia: string[] = [];
  const config = REBROADCAST_CONFIG[speedMode] || REBROADCAST_CONFIG.fast;

  // ── Initial blast: fire to all endpoints in parallel ──
  const [jitoSig, primarySig, fallbackSig] = await Promise.all([
    sendToJito(signedTransactionBase64),
    sendToRpc(swapConfig.solanaRpcUrl, signedTransactionBase64, "Primary"),
    swapConfig.solanaRpcUrlFallback !== swapConfig.solanaRpcUrl
      ? sendToRpc(swapConfig.solanaRpcUrlFallback, signedTransactionBase64, "Fallback")
      : Promise.resolve(null),
  ]);

  if (jitoSig && jitoSig !== "BLOCKHASH_EXPIRED") sentVia.push("jito");
  if (primarySig && primarySig !== "BLOCKHASH_EXPIRED") sentVia.push("primary");
  if (fallbackSig && fallbackSig !== "BLOCKHASH_EXPIRED") sentVia.push("fallback");

  const signature = [jitoSig, primarySig, fallbackSig].find(
    s => s && s !== "BLOCKHASH_EXPIRED" && s !== "ALREADY_PROCESSED"
  ) || null;

  // If blockhash already expired on initial send, bail immediately
  if (!signature && (jitoSig === "BLOCKHASH_EXPIRED" || primarySig === "BLOCKHASH_EXPIRED")) {
    return {
      ok: false,
      code: "SEND_FAILED",
      message: "Transaction blockhash expired. Please try again.",
    };
  }

  if (!signature) {
    return {
      ok: false,
      code: "SEND_FAILED",
      message: "Failed to send transaction to any endpoint",
    };
  }

  console.log(`[InstantSend] Initial send via: ${sentVia.join(", ")} | sig: ${signature}`);

  // ── Background rebroadcast loop — keeps resending until confirmed or expired ──
  // Don't await this — return the signature to the client immediately
  rebroadcastLoop(signedTransactionBase64, signature, speedMode, config).catch(err => {
    console.warn("[Rebroadcast] Loop error:", err.message);
  });

  return {
    ok: true,
    signature,
    sentVia,
  };
}

/**
 * Keep rebroadcasting the transaction every N ms until it's confirmed
 * or the blockhash expires. Runs in the background after initial send.
 */
async function rebroadcastLoop(
  signedTxBase64: string,
  signature: string,
  speedMode: SpeedMode,
  config: { intervalMs: number; maxDurationMs: number }
): Promise<void> {
  const start = Date.now();
  let round = 0;
  const hasFallback =
    swapConfig.solanaRpcUrlFallback &&
    swapConfig.solanaRpcUrlFallback !== swapConfig.solanaRpcUrl;

  while (Date.now() - start < config.maxDurationMs) {
    // Wait before next round
    await new Promise(resolve => setTimeout(resolve, config.intervalMs));
    round++;

    // Check if already confirmed
    const confirmations = await Promise.all([
      checkConfirmation(swapConfig.solanaRpcUrl, signature),
      hasFallback
        ? checkConfirmation(swapConfig.solanaRpcUrlFallback, signature)
        : Promise.resolve(false),
    ]);
    const confirmed = confirmations.some(Boolean);
    if (confirmed) {
      console.log(`[Rebroadcast] TX confirmed after ${round} rounds (${Date.now() - start}ms)`);
      return;
    }

    // Resend to all endpoints in parallel
    const results = await Promise.all([
      sendToJito(signedTxBase64),
      sendToRpc(swapConfig.solanaRpcUrl, signedTxBase64, `Rebroadcast-${round}`, 3),
      hasFallback
        ? sendToRpc(swapConfig.solanaRpcUrlFallback, signedTxBase64, `Rebroadcast-Fallback-${round}`, 3)
        : Promise.resolve(null),
    ]);

    // If blockhash expired, stop
    if (results.some(r => r === "BLOCKHASH_EXPIRED")) {
      console.log(`[Rebroadcast] Blockhash expired after ${round} rounds (${Date.now() - start}ms)`);
      return;
    }

    // If already processed, we're done
    if (results.some(r => r === "ALREADY_PROCESSED")) {
      console.log(`[Rebroadcast] TX already processed after ${round} rounds (${Date.now() - start}ms)`);
      return;
    }

    console.log(`[Rebroadcast] Round ${round} sent (${Date.now() - start}ms elapsed)`);
  }

  console.log(`[Rebroadcast] Max duration reached (${config.maxDurationMs}ms), stopping`);
}
