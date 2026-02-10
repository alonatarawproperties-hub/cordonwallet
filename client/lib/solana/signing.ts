/**
 * Solana signing functions extracted from blockchain/transactions.ts
 * for Phase I (Solana-only) support.
 */
import { getMnemonic, getWalletPrivateKey, WalletLockedError } from "../wallet-engine";

interface TransactionError {
  code: string;
  message: string;
  details?: string;
}

class TransactionFailedError extends Error {
  code: string;
  details?: string;

  constructor(error: TransactionError) {
    super(error.message);
    this.name = "TransactionFailedError";
    this.code = error.code;
    this.details = error.details;
  }
}

function formatTransactionError(error: unknown): TransactionError {
  if (error instanceof WalletLockedError) {
    return {
      code: "WALLET_LOCKED",
      message: "Please unlock your wallet first",
    };
  }

  if (error instanceof Error) {
    return {
      code: "UNKNOWN",
      message: error.message,
    };
  }

  return {
    code: "UNKNOWN",
    message: "An unknown error occurred",
  };
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
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}

async function getSolanaSecretKey(walletId: string): Promise<Uint8Array> {
  const { deriveSolanaKeypair } = await import("../solana/keys");
  const bs58 = await import("bs58");

  const mnemonic = await getMnemonic(walletId);
  if (mnemonic) {
    return deriveSolanaKeypair(mnemonic).secretKey;
  }

  const privateKey = await getWalletPrivateKey(walletId);
  if (privateKey?.type === "solana") {
    const decoded = bs58.default.decode(privateKey.key);
    if (decoded.length === 64) {
      return decoded;
    }
  }

  throw new WalletLockedError();
}

export interface SignSolanaMessageParams {
  walletId: string;
  message: string | Uint8Array;
}

export async function signSolanaMessage(params: SignSolanaMessageParams): Promise<string> {
  const { walletId, message } = params;

  try {
    const nacl = await import("tweetnacl");
    const bs58 = await import("bs58");

    const secretKey = await getSolanaSecretKey(walletId);

    const messageBytes =
      message instanceof Uint8Array
        ? message
        : new TextEncoder().encode(message);

    const signature = nacl.sign.detached(messageBytes, secretKey);
    return bs58.default.encode(signature);
  } catch (error) {
    if (error instanceof WalletLockedError) {
      throw error;
    }
    const txError = formatTransactionError(error);
    throw new TransactionFailedError(txError);
  }
}

export interface SignSolanaTransactionParams {
  walletId: string;
  transaction: string;
}

export async function signSolanaTransaction(params: SignSolanaTransactionParams): Promise<string> {
  const { walletId, transaction } = params;

  try {
    const { Transaction, VersionedTransaction, Keypair } = await import("@solana/web3.js");

    const secretKey = await getSolanaSecretKey(walletId);
    const keypair = Keypair.fromSecretKey(secretKey);

    const txBytes = base64ToUint8Array(transaction);

    let signedTxBase64: string;

    try {
      const versionedTx = VersionedTransaction.deserialize(txBytes);
      versionedTx.sign([keypair]);
      signedTxBase64 = uint8ArrayToBase64(versionedTx.serialize());
    } catch {
      const legacyTx = Transaction.from(txBytes);
      legacyTx.sign(keypair);
      signedTxBase64 = uint8ArrayToBase64(legacyTx.serialize());
    }

    return signedTxBase64;
  } catch (error) {
    if (error instanceof WalletLockedError) {
      throw error;
    }
    const txError = formatTransactionError(error);
    throw new TransactionFailedError(txError);
  }
}

export async function signAllSolanaTransactions(
  walletId: string,
  transactions: string[]
): Promise<string[]> {
  const results: string[] = [];
  for (const tx of transactions) {
    const signed = await signSolanaTransaction({ walletId, transaction: tx });
    results.push(signed);
  }
  return results;
}
