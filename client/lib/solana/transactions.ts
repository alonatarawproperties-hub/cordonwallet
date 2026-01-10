import { getApiUrl } from "@/lib/query-client";
import { deriveSolanaKeypair } from "./keys";
import { getSolanaExplorerTxUrl } from "./client";
import * as nacl from "tweetnacl";

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

export interface SendSolResult {
  signature: string;
  explorerUrl: string;
  status: "confirmed" | "failed";
  error?: string;
}

export interface SendSplResult {
  signature: string;
  explorerUrl: string;
  status: "confirmed" | "failed";
  error?: string;
}

export async function sendSol(
  mnemonic: string,
  toAddress: string,
  amountSol: string
): Promise<SendSolResult> {
  const { publicKey, secretKey } = deriveSolanaKeypair(mnemonic);
  
  const apiUrl = getApiUrl();
  const prepareUrl = new URL("/api/solana/prepare-sol-transfer", apiUrl);
  
  const prepareResponse = await fetch(prepareUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromAddress: publicKey,
      toAddress,
      amountSol,
    }),
  });
  
  if (!prepareResponse.ok) {
    const error = await prepareResponse.json();
    throw new Error(error.error || "Failed to prepare transaction");
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
    throw new Error(error.error || "Failed to send transaction");
  }
  
  const result = await sendResponse.json();
  
  return {
    signature: result.signature,
    explorerUrl: getSolanaExplorerTxUrl(result.signature),
    status: result.status,
    error: result.error,
  };
}

export interface SendSplOptions {
  mnemonic: string;
  mintAddress: string;
  toAddress: string;
  amount: string;
  decimals: number;
  allowCreateAta?: boolean;
}

export async function checkRecipientAtaExists(
  mintAddress: string,
  recipientAddress: string
): Promise<boolean> {
  const apiUrl = getApiUrl();
  const url = new URL("/api/solana/check-ata", apiUrl);
  url.searchParams.set("mint", mintAddress);
  url.searchParams.set("owner", recipientAddress);
  
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error("Failed to check token account");
  }
  
  const { exists } = await response.json();
  return exists;
}

export async function sendSplToken(options: SendSplOptions): Promise<SendSplResult> {
  const { mnemonic, mintAddress, toAddress, amount, decimals, allowCreateAta = true } = options;
  
  const { publicKey, secretKey } = deriveSolanaKeypair(mnemonic);
  
  const apiUrl = getApiUrl();
  const prepareUrl = new URL("/api/solana/prepare-spl-transfer", apiUrl);
  
  const prepareResponse = await fetch(prepareUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromAddress: publicKey,
      toAddress,
      mintAddress,
      amount,
      decimals,
      allowCreateAta,
    }),
  });
  
  if (!prepareResponse.ok) {
    const error = await prepareResponse.json();
    throw new Error(error.error || "Failed to prepare SPL transfer");
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
    throw new Error(error.error || "Failed to send SPL transaction");
  }
  
  const result = await sendResponse.json();
  
  return {
    signature: result.signature,
    explorerUrl: getSolanaExplorerTxUrl(result.signature),
    status: result.status,
    error: result.error,
  };
}

export async function estimateSolTransferFee(): Promise<number> {
  return 5000;
}
