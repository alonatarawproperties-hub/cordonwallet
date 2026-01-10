import * as bip39 from "@scure/bip39";
import { sha512 } from "@noble/hashes/sha2";
import { hmac } from "@noble/hashes/hmac";
import * as nacl from "tweetnacl";
import bs58 from "bs58";

const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";
const ED25519_CURVE = "ed25519 seed";

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

interface Keys {
  key: Uint8Array;
  chainCode: Uint8Array;
}

function getMasterKeyFromSeed(seed: string): Keys {
  const seedBytes = hexToUint8Array(seed);
  const I = hmac(sha512, new TextEncoder().encode(ED25519_CURVE), seedBytes);
  const IL = I.slice(0, 32);
  const IR = I.slice(32);
  return {
    key: IL,
    chainCode: IR,
  };
}

function CKDPriv({ key, chainCode }: Keys, index: number): Keys {
  const indexBuffer = new Uint8Array(4);
  const view = new DataView(indexBuffer.buffer);
  view.setUint32(0, index, false);
  
  const data = new Uint8Array(1 + key.length + 4);
  data[0] = 0;
  data.set(key, 1);
  data.set(indexBuffer, key.length + 1);
  
  const I = hmac(sha512, chainCode, data);
  const IL = I.slice(0, 32);
  const IR = I.slice(32);
  return {
    key: IL,
    chainCode: IR,
  };
}

const pathRegex = /^m(\/\d+'?)+$/;

function derivePath(path: string, seedHex: string): Keys {
  if (!pathRegex.test(path)) {
    throw new Error("Invalid derivation path");
  }
  
  const { key, chainCode } = getMasterKeyFromSeed(seedHex);
  const segments = path
    .replace("m/", "")
    .split("/")
    .map((segment) => {
      if (segment.endsWith("'")) {
        return parseInt(segment.slice(0, -1), 10) + 0x80000000;
      }
      return parseInt(segment, 10);
    });
  
  return segments.reduce(
    (parentKeys, segment) => CKDPriv(parentKeys, segment),
    { key, chainCode }
  );
}

export interface SolanaKeyResult {
  publicKey: string;
  secretKey: Uint8Array;
}

export function deriveSolanaKeypair(mnemonic: string): SolanaKeyResult {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const seedHex = uint8ArrayToHex(seed);
  const derivedSeed = derivePath(SOLANA_DERIVATION_PATH, seedHex);
  
  const keypair = nacl.sign.keyPair.fromSeed(derivedSeed.key);
  const publicKey = bs58.encode(keypair.publicKey);
  
  return {
    publicKey,
    secretKey: keypair.secretKey,
  };
}

export function deriveSolanaAddress(mnemonic: string): string {
  const { publicKey } = deriveSolanaKeypair(mnemonic);
  return publicKey;
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    const decoded = bs58.decode(address);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

export function shortenSolanaAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
