import * as bip39 from "@scure/bip39";
import { derivePath } from "ed25519-hd-key";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";

export interface SolanaKeyResult {
  publicKey: string;
  keypair: Keypair;
}

export function deriveSolanaKeypair(mnemonic: string): SolanaKeyResult {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const seedHex = Buffer.from(seed).toString("hex");
  const derivedSeed = derivePath(SOLANA_DERIVATION_PATH, seedHex);
  const keypair = Keypair.fromSeed(derivedSeed.key);
  
  return {
    publicKey: keypair.publicKey.toBase58(),
    keypair,
  };
}

export function deriveSolanaAddress(mnemonic: string): string {
  const { publicKey } = deriveSolanaKeypair(mnemonic);
  return publicKey;
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

export function shortenSolanaAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
