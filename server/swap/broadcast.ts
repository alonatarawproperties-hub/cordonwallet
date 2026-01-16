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
    if (txBytes.length >= 64) {
      const sigBytes = txBytes.slice(0, 64);
      return Buffer.from(sigBytes).toString("base64");
    }
  } catch {}
  return null;
}

export async function broadcastTransaction(params: {
  signedTransactionBase64: string;
  mode: SpeedMode;
}): Promise<SendResult> {
  const { signedTransactionBase64, mode } = params;
  
  const retryConfig = swapConfig.broadcastRetries[mode];
  
  console.log(`[Broadcast] Sending tx, mode: ${mode}, retries: ${retryConfig.maxRetries}`);
  
  const primaryResult = await sendToRpc(
    swapConfig.solanaRpcUrl,
    signedTransactionBase64,
    retryConfig.maxRetries,
    retryConfig.timeoutMs
  );
  
  if (primaryResult.signature) {
    return {
      ok: true,
      signature: primaryResult.signature,
      rpc: "primary",
    };
  }
  
  if (swapConfig.solanaRpcUrlFallback && 
      swapConfig.solanaRpcUrlFallback !== swapConfig.solanaRpcUrl) {
    console.log("[Broadcast] Primary failed, trying fallback RPC...");
    
    const fallbackResult = await sendToRpc(
      swapConfig.solanaRpcUrlFallback,
      signedTransactionBase64,
      Math.max(1, retryConfig.maxRetries - 1),
      retryConfig.timeoutMs / 2
    );
    
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
      message: `Both RPCs failed. Primary: ${primaryResult.error}, Fallback: ${fallbackResult.error}`,
    };
  }
  
  return {
    ok: false,
    code: "SEND_FAILED",
    message: primaryResult.error || "Failed to send transaction",
  };
}

export async function getTransactionStatus(signature: string): Promise<{
  confirmed: boolean;
  finalized: boolean;
  error?: string;
}> {
  try {
    const response = await fetch(swapConfig.solanaRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: true }],
      }),
    });
    
    const data = await response.json();
    const status = data.result?.value?.[0];
    
    if (!status) {
      return { confirmed: false, finalized: false };
    }
    
    if (status.err) {
      return { 
        confirmed: false, 
        finalized: false, 
        error: JSON.stringify(status.err) 
      };
    }
    
    return {
      confirmed: status.confirmationStatus === "confirmed" || 
                 status.confirmationStatus === "finalized",
      finalized: status.confirmationStatus === "finalized",
    };
  } catch (err: any) {
    return { 
      confirmed: false, 
      finalized: false, 
      error: err.message 
    };
  }
}
