import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";
import { deriveSolanaKeypair } from "@/lib/solana/keys";
import { getMnemonic } from "@/lib/wallet-engine";
import { isFeeWalletConfigured } from "@/constants/successFee";
import { getCordonSolTreasury } from "@/constants/treasury";
import * as nacl from "tweetnacl";

const PENDING_FEES_KEY = "cordon_pending_success_fees";
const RETRY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ATTEMPTS = 3;
const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface PendingFeeRecord {
  id: string;
  createdAt: number;
  userPubkey: string;
  walletId: string;
  feeLamports: number;
  swapSignature: string;
  status: "pending" | "paid" | "failed";
  attempts: number;
  lastAttemptAt?: number;
  paidSignature?: string;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function loadPendingFees(): Promise<PendingFeeRecord[]> {
  try {
    const json = await AsyncStorage.getItem(PENDING_FEES_KEY);
    if (json) {
      return JSON.parse(json);
    }
  } catch (e) {
    console.error("[SuccessFee] Failed to load pending fees:", e);
  }
  return [];
}

async function savePendingFees(fees: PendingFeeRecord[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_FEES_KEY, JSON.stringify(fees));
  } catch (e) {
    console.error("[SuccessFee] Failed to save pending fees:", e);
  }
}

export async function enqueuePendingFee(
  userPubkey: string,
  walletId: string,
  feeLamports: number,
  swapSignature: string
): Promise<void> {
  const fees = await loadPendingFees();
  
  const existing = fees.find(f => f.swapSignature === swapSignature);
  if (existing) {
    console.log("[SuccessFee] Fee already queued for swap:", swapSignature);
    return;
  }
  
  const record: PendingFeeRecord = {
    id: `fee_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    userPubkey,
    walletId,
    feeLamports,
    swapSignature,
    status: "pending",
    attempts: 0,
  };
  
  fees.unshift(record);
  await savePendingFees(fees);
  console.log("[SuccessFee] Enqueued pending fee:", record.id);
}

export async function markFeePaid(
  swapSignature: string,
  paidSignature: string
): Promise<void> {
  const fees = await loadPendingFees();
  const fee = fees.find(f => f.swapSignature === swapSignature);
  if (fee) {
    fee.status = "paid";
    fee.paidSignature = paidSignature;
    await savePendingFees(fees);
  }
}

async function sendFeeTransaction(
  mnemonic: string,
  fromAddress: string,
  feeLamports: number
): Promise<{ success: boolean; signature?: string; error?: string }> {
  const { publicKey, secretKey } = deriveSolanaKeypair(mnemonic);
  const feeWallet = getCordonSolTreasury();
  
  if (!feeWallet) {
    if (__DEV__) {
      console.warn("[SuccessFee] Treasury not configured, skipping fee");
    }
    return { success: true, signature: undefined };
  }
  
  const amountSol = (feeLamports / 1_000_000_000).toFixed(9);
  
  const apiUrl = getApiUrl();
  
  try {
    const prepareUrl = new URL("/api/solana/prepare-sol-transfer", apiUrl);
    const prepareResponse = await fetch(prepareUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromAddress: publicKey,
        toAddress: feeWallet,
        amountSol,
      }),
    });
    
    if (!prepareResponse.ok) {
      const error = await prepareResponse.json();
      return { success: false, error: error.error || "Failed to prepare fee tx" };
    }
    
    const { transactionBase64, message } = await prepareResponse.json();
    
    const messageBytes = base64ToUint8Array(message);
    const signature = nacl.sign.detached(messageBytes, secretKey);
    
    const sendUrl = new URL("/api/solana/send-signed-transaction", apiUrl);
    const sendResponse = await fetch(sendUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionBase64,
        signatureBase64: uint8ArrayToBase64(signature),
        publicKeyBase58: publicKey,
      }),
    });
    
    if (!sendResponse.ok) {
      const error = await sendResponse.json();
      return { success: false, error: error.error || "Failed to send fee tx" };
    }
    
    const result = await sendResponse.json();
    
    if (result.status === "failed") {
      return { success: false, error: result.error || "Fee tx failed on-chain" };
    }
    
    return { success: true, signature: result.signature };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export async function tryChargeSuccessFeeNow(
  walletId: string,
  userPubkey: string,
  feeLamports: number,
  swapSignature: string
): Promise<{ success: boolean; signature?: string; error?: string }> {
  if (feeLamports <= 0) {
    return { success: true, signature: undefined };
  }
  
  if (!isFeeWalletConfigured()) {
    console.warn("[SuccessFee] Fee wallet not configured, skipping charge");
    return { success: true, signature: undefined };
  }
  
  try {
    const mnemonic = await getMnemonic(walletId);
    if (!mnemonic) {
      await enqueuePendingFee(userPubkey, walletId, feeLamports, swapSignature);
      return { success: false, error: "wallet_locked" };
    }
    
    const result = await sendFeeTransaction(mnemonic, userPubkey, feeLamports);
    
    if (!result.success) {
      console.log("[SuccessFee] Fee charge failed, enqueueing:", result.error);
      await enqueuePendingFee(userPubkey, walletId, feeLamports, swapSignature);
      return result;
    }
    
    console.log("[SuccessFee] Fee charged successfully:", result.signature);
    return result;
    
  } catch (e) {
    console.error("[SuccessFee] Error charging fee:", e);
    await enqueuePendingFee(userPubkey, walletId, feeLamports, swapSignature);
    return { success: false, error: String(e) };
  }
}

export async function retryPendingFeesForCurrentWallet(
  walletId: string,
  userPubkey: string
): Promise<{ retried: number; paid: number }> {
  if (!isFeeWalletConfigured()) {
    return { retried: 0, paid: 0 };
  }
  
  const fees = await loadPendingFees();
  const now = Date.now();
  let retried = 0;
  let paid = 0;
  
  const cleanedFees = fees.filter(f => {
    if (f.status === "paid" && now - f.createdAt > CLEANUP_AFTER_MS) {
      return false;
    }
    return true;
  });
  
  for (const fee of cleanedFees) {
    if (fee.status !== "pending") continue;
    if (fee.userPubkey !== userPubkey) continue;
    if (fee.walletId !== walletId) continue;
    
    if (fee.attempts >= MAX_ATTEMPTS) {
      fee.status = "failed";
      continue;
    }
    
    if (fee.lastAttemptAt && now - fee.lastAttemptAt < RETRY_INTERVAL_MS) {
      continue;
    }
    
    retried++;
    fee.attempts++;
    fee.lastAttemptAt = now;
    
    try {
      const mnemonic = await getMnemonic(walletId);
      if (!mnemonic) {
        console.log("[SuccessFee] Wallet locked, skipping retry");
        continue;
      }
      
      const result = await sendFeeTransaction(mnemonic, userPubkey, fee.feeLamports);
      
      if (result.success && result.signature) {
        fee.status = "paid";
        fee.paidSignature = result.signature;
        paid++;
        console.log("[SuccessFee] Retry succeeded:", result.signature);
      }
    } catch (e) {
      console.error("[SuccessFee] Retry failed:", e);
    }
  }
  
  await savePendingFees(cleanedFees);
  return { retried, paid };
}

export async function getPendingFeesCount(userPubkey: string): Promise<number> {
  const fees = await loadPendingFees();
  return fees.filter(f => f.status === "pending" && f.userPubkey === userPubkey).length;
}

export async function hasPendingFeeForSwap(swapSignature: string): Promise<boolean> {
  const fees = await loadPendingFees();
  return fees.some(f => f.swapSignature === swapSignature && f.status === "pending");
}
