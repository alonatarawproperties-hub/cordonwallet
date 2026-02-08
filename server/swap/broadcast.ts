import { swapConfig, SpeedMode } from "./config";
import type { SendResult } from "./types";

async function sendToRpc(
  rpcUrl: string, 
  signedTxBase64: string,
  retries: number,
  timeoutMs: number
): Promise<{ signature?: string; error?: string }> {
  const txBytes = Buffer.from(signedTxBase64, "base64");
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs / (retries + 1));
      
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
        console.log(`[Broadcast] Success on attempt ${attempt + 1}:`, data.result);
        return { signature: data.result };
      }
      
      if (data.error) {
        const errorMsg = data.error.message || JSON.stringify(data.error);
        console.warn(`[Broadcast] RPC error on attempt ${attempt + 1}:`, errorMsg);
        
        if (errorMsg.includes("already been processed") || 
            errorMsg.includes("AlreadyProcessed")) {
          const sig = extractSignatureFromTx(txBytes);
          if (sig) return { signature: sig };
        }
        
        if (attempt === retries) {
          return { error: errorMsg };
        }
      }
    } catch (err: any) {
      console.warn(`[Broadcast] Attempt ${attempt + 1} failed:`, err.message);
      if (attempt === retries) {
        return { error: err.message };
      }
    }
    
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  
  return { error: "Max retries exceeded" };
}

function extractSignatureFromTx(txBytes: Uint8Array): string | null {
  try {
    // The first byte of a VersionedTransaction is the signature count (compact-u16),
    // followed by the 64-byte signature(s). For a single-signer tx: [1, sig0..sig63, ...]
    // We need to skip the compact-u16 length prefix to get the actual signature bytes.
    if (txBytes.length < 66) return null;
    const sigCount = txBytes[0];
    if (sigCount < 1) return null;
    const sigBytes = txBytes.slice(1, 65);
    // Encode as base58 — Solana RPC expects/returns base58 signatures
    return bs58Encode(sigBytes);
  } catch {}
  return null;
}

/** Minimal base58 encoder (avoids adding bs58 dependency to server) */
function bs58Encode(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = BigInt(0);
  for (const b of bytes) num = num * 256n + BigInt(b);
  let str = "";
  while (num > 0n) {
    str = ALPHABET[Number(num % 58n)] + str;
    num = num / 58n;
  }
  for (const b of bytes) {
    if (b === 0) str = "1" + str;
    else break;
  }
  return str;
}

export async function broadcastTransaction(params: {
  signedTransactionBase64: string;
  mode: SpeedMode;
}): Promise<SendResult> {
  const { signedTransactionBase64, mode } = params;
  
  const retryConfig = swapConfig.broadcastRetries[mode];
  
  console.log(`[Broadcast] Sending tx, mode: ${mode}, retries: ${retryConfig.maxRetries}`);

  const hasFallback = swapConfig.solanaRpcUrlFallback &&
    swapConfig.solanaRpcUrlFallback !== swapConfig.solanaRpcUrl;

  // Send to both RPCs in parallel for fastest landing
  const primaryPromise = sendToRpc(
    swapConfig.solanaRpcUrl,
    signedTransactionBase64,
    retryConfig.maxRetries,
    retryConfig.timeoutMs
  );

  const fallbackPromise = hasFallback
    ? sendToRpc(
        swapConfig.solanaRpcUrlFallback,
        signedTransactionBase64,
        Math.max(1, retryConfig.maxRetries - 1),
        retryConfig.timeoutMs
      )
    : Promise.resolve({ error: "no fallback" } as { signature?: string; error?: string });

  const [primaryResult, fallbackResult] = await Promise.all([primaryPromise, fallbackPromise]);

  if (primaryResult.signature) {
    return {
      ok: true,
      signature: primaryResult.signature,
      rpc: "primary",
    };
  }

  if (fallbackResult.signature) {
    return {
      ok: true,
      signature: fallbackResult.signature,
      rpc: "fallback",
    };
  }

  return {
    ok: false,
    code: "SEND_FAILED",
    message: hasFallback
      ? `Both RPCs failed. Primary: ${primaryResult.error}, Fallback: ${fallbackResult.error}`
      : primaryResult.error || "Failed to send transaction",
  };
}

export async function getTransactionStatus(signature: string): Promise<{
  confirmed: boolean;
  finalized: boolean;
  processed: boolean;
  confirmationStatus?: string;
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(swapConfig.solanaRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: true }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json();
    const status = data.result?.value?.[0];

    if (!status) {
      return { confirmed: false, finalized: false, processed: false };
    }

    if (status.err) {
      return {
        confirmed: false,
        finalized: false,
        processed: false,
        confirmationStatus: status.confirmationStatus,
        error: JSON.stringify(status.err)
      };
    }

    const level = status.confirmationStatus;

    return {
      confirmed: level === "confirmed" || level === "finalized",
      finalized: level === "finalized",
      processed: level === "processed" || level === "confirmed" || level === "finalized",
      confirmationStatus: level,
    };
  } catch (err: any) {
    return {
      confirmed: false,
      finalized: false,
      processed: false,
      error: err.message
    };
  }
}
