/**
 * Jito + Multi-RPC instant send
 *
 * Fires the signed transaction to Jito block engine AND regular RPCs
 * in parallel. Returns the signature immediately — no waiting for
 * confirmation. This is how TG bot snipers land trades fast.
 */

import { swapConfig, SpeedMode } from "./config";
import type { InstantSendResult } from "./types";

const JITO_SEND_URL = `${swapConfig.jitoBlockEngineUrl}/api/v1/transactions`;

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
            maxRetries: 0,
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
      // If already processed, that's fine
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

async function sendToRpc(rpcUrl: string, signedTxBase64: string, label: string): Promise<string | null> {
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
            maxRetries: 0,
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
      console.warn(`[${label}] Send error:`, msg);
      if (msg.includes("already been processed") || msg.includes("AlreadyProcessed")) {
        return data.result || null;
      }
    }

    return null;
  } catch (err: any) {
    console.warn(`[${label}] Send failed:`, err.message);
    return null;
  }
}

/**
 * Fire signed transaction to Jito + primary RPC + fallback RPC in parallel.
 * Returns the first successful signature immediately.
 */
export async function instantSend(params: {
  signedTransactionBase64: string;
  speedMode: SpeedMode;
}): Promise<InstantSendResult> {
  const { signedTransactionBase64 } = params;
  const sentVia: string[] = [];

  // Fire all three in parallel — first one to return a signature wins
  const [jitoSig, primarySig, fallbackSig] = await Promise.all([
    sendToJito(signedTransactionBase64),
    sendToRpc(swapConfig.solanaRpcUrl, signedTransactionBase64, "Primary"),
    swapConfig.solanaRpcUrlFallback !== swapConfig.solanaRpcUrl
      ? sendToRpc(swapConfig.solanaRpcUrlFallback, signedTransactionBase64, "Fallback")
      : Promise.resolve(null),
  ]);

  if (jitoSig) sentVia.push("jito");
  if (primarySig) sentVia.push("primary");
  if (fallbackSig) sentVia.push("fallback");

  const signature = jitoSig || primarySig || fallbackSig;

  if (!signature) {
    return {
      ok: false,
      code: "SEND_FAILED",
      message: "Failed to send transaction to any endpoint",
    };
  }

  console.log(`[InstantSend] Sent via: ${sentVia.join(", ")} | sig: ${signature}`);

  return {
    ok: true,
    signature,
    sentVia,
  };
}
