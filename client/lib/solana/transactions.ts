import { getApiUrl, getApiHeaders } from "@/lib/query-client";
import { deriveSolanaKeypair } from "./keys";
import { getSolanaExplorerTxUrl } from "./client";
import * as nacl from "tweetnacl";
import bs58 from "bs58";

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// --- Security: Zero out key material after use ---
function wipeBytes(arr: Uint8Array): void {
  arr.fill(0);
}

/**
 * Security: Validate that a Solana transaction message references the expected
 * sender (as fee payer) and the expected recipient in the account keys.
 *
 * Solana legacy message layout:
 *   [0]    numRequiredSignatures
 *   [1]    numReadonlySignedAccounts
 *   [2]    numReadonlyUnsignedAccounts
 *   [3]    numAccountKeys (compact-u16, usually 1 byte for small tx)
 *   [4..]  account keys (32 bytes each)
 *
 * We verify:
 *   1. The first account key (fee payer) matches the sender.
 *   2. The expected recipient address appears somewhere in the account keys.
 *
 * This is a defense-in-depth check — a compromised server returning a
 * transaction to a different address will be caught before signing.
 */
function validateTransactionMessage(
  messageBytes: Uint8Array,
  expectedSenderPubkey: string,
  expectedRecipientAddress: string,
): void {
  if (messageBytes.length < 68) {
    throw new Error("Transaction message too short to be valid");
  }

  if (messageBytes.every(b => b === 0)) {
    throw new Error("Transaction message is empty/zeroed");
  }

  // Decode expected addresses from base58 to raw 32-byte pubkeys
  let senderBytes: Uint8Array;
  let recipientBytes: Uint8Array;
  try {
    senderBytes = bs58.decode(expectedSenderPubkey);
    recipientBytes = bs58.decode(expectedRecipientAddress);
  } catch {
    throw new Error("Invalid sender or recipient address for validation");
  }

  if (senderBytes.length !== 32 || recipientBytes.length !== 32) {
    throw new Error("Address must be 32 bytes");
  }

  // Parse compact-u16 for number of account keys (byte at offset 3)
  // For transactions with < 128 accounts this is a single byte
  const numAccountKeys = messageBytes[3];
  if (numAccountKeys < 2) {
    throw new Error("Transaction has fewer than 2 account keys");
  }

  const accountKeysStart = 4; // after the 3 header bytes + 1 compact-u16 byte
  const accountKeysEnd = accountKeysStart + numAccountKeys * 32;

  if (accountKeysEnd > messageBytes.length) {
    throw new Error("Transaction message truncated — not enough bytes for declared account keys");
  }

  // Check 1: Fee payer (first account key) must be the sender
  const feePayer = messageBytes.slice(accountKeysStart, accountKeysStart + 32);
  let feePayerMatch = true;
  for (let i = 0; i < 32; i++) {
    if (feePayer[i] !== senderBytes[i]) {
      feePayerMatch = false;
      break;
    }
  }
  if (!feePayerMatch) {
    throw new Error("Transaction fee payer does not match sender — possible substitution attack");
  }

  // Check 2: Recipient must appear somewhere in the account keys
  let recipientFound = false;
  for (let k = 0; k < numAccountKeys; k++) {
    const offset = accountKeysStart + k * 32;
    let match = true;
    for (let i = 0; i < 32; i++) {
      if (messageBytes[offset + i] !== recipientBytes[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      recipientFound = true;
      break;
    }
  }
  if (!recipientFound) {
    throw new Error("Expected recipient not found in transaction — possible substitution attack");
  }
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

export type SolanaKeypair = { publicKey: string; secretKey: Uint8Array };

export async function sendSol(
  mnemonicOrKeys: string | SolanaKeypair,
  toAddress: string,
  amountSol: string
): Promise<SendSolResult> {
  const { publicKey, secretKey } = typeof mnemonicOrKeys === "string"
    ? deriveSolanaKeypair(mnemonicOrKeys)
    : mnemonicOrKeys;

  try {
    const apiUrl = getApiUrl();
    const prepareUrl = new URL("/api/solana/prepare-sol-transfer", apiUrl);

    const prepareResponse = await fetch(prepareUrl.toString(), {
      method: "POST",
      headers: getApiHeaders({ "Content-Type": "application/json" }),
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

    // Security: Validate the transaction message before signing
    validateTransactionMessage(messageBytes, publicKey, toAddress);

    const signature = nacl.sign.detached(messageBytes, secretKey);

    const sendUrl = new URL("/api/solana/send-signed-transaction", apiUrl);
    const sendResponse = await fetch(sendUrl.toString(), {
      method: "POST",
      headers: getApiHeaders({ "Content-Type": "application/json" }),
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
  } finally {
    // Security: Wipe secret key from memory
    wipeBytes(secretKey);
  }
}

export interface SendSplOptions {
  mnemonic?: string;
  keys?: SolanaKeypair;
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
  
  const response = await fetch(url.toString(), { headers: getApiHeaders() });
  if (!response.ok) {
    throw new Error("Failed to check token account");
  }
  
  const { exists } = await response.json();
  return exists;
}

export async function sendSplToken(options: SendSplOptions): Promise<SendSplResult> {
  const { mnemonic, keys, mintAddress, toAddress, amount, decimals, allowCreateAta = true } = options;

  const { publicKey, secretKey } = keys
    ? keys
    : deriveSolanaKeypair(mnemonic!);

  try {
    const apiUrl = getApiUrl();
    const prepareUrl = new URL("/api/solana/prepare-spl-transfer", apiUrl);

    const prepareResponse = await fetch(prepareUrl.toString(), {
      method: "POST",
      headers: getApiHeaders({ "Content-Type": "application/json" }),
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

    // Security: Validate the transaction message before signing
    validateTransactionMessage(messageBytes, publicKey, toAddress);

    const signature = nacl.sign.detached(messageBytes, secretKey);

    const sendUrl = new URL("/api/solana/send-signed-transaction", apiUrl);
    const sendResponse = await fetch(sendUrl.toString(), {
      method: "POST",
      headers: getApiHeaders({ "Content-Type": "application/json" }),
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
  } finally {
    // Security: Wipe secret key from memory
    wipeBytes(secretKey);
  }
}

export async function estimateSolTransferFee(): Promise<number> {
  return 5000;
}
