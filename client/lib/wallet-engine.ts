import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes, bytesToHex, hexToBytes } from "@noble/ciphers/utils.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { deriveSolanaAddress } from "./solana/keys";

export interface MultiChainAddresses {
  evm: `0x${string}`;
  solana: string;
}

export interface WalletRecord {
  id: string;
  name: string;
  address: `0x${string}`;
  addresses: MultiChainAddresses;
  createdAt: number;
}

interface EncryptedVault {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}

interface DecryptedSecrets {
  mnemonics: Record<string, string>;
}

const STORAGE_KEYS = {
  VAULT: "cordon_vault",
  PIN_HASH: "cordon_pin_hash",
  VAULT_META: "@cordon/vault_meta",
};

const PBKDF2_ITERATIONS = 100000;

let cachedSecrets: DecryptedSecrets | null = null;
let isVaultUnlocked = false;

function deriveKeyFromPin(pin: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, pin, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 });
}

function runAsync<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (e) {
        reject(e);
      }
    }, 0);
  });
}

async function encryptSecrets(secrets: DecryptedSecrets, pin: string): Promise<EncryptedVault> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  
  const key = await runAsync(() => deriveKeyFromPin(pin, salt));
  
  const plaintext = new TextEncoder().encode(JSON.stringify(secrets));
  const cipher = gcm(key, iv);
  const ciphertext = cipher.encrypt(plaintext);
  
  return {
    version: 1,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(ciphertext),
  };
}

async function decryptSecrets(vault: EncryptedVault, pin: string): Promise<DecryptedSecrets | null> {
  try {
    const salt = hexToBytes(vault.salt);
    const iv = hexToBytes(vault.iv);
    const ciphertext = hexToBytes(vault.ciphertext);
    
    const key = await runAsync(() => deriveKeyFromPin(pin, salt));
    
    const cipher = gcm(key, iv);
    const plaintext = cipher.decrypt(ciphertext);
    const json = new TextDecoder().decode(plaintext);
    
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function mnemonicToAddress(mnemonic: string): `0x${string}` {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const childKey = hdKey.derive("m/44'/60'/0'/0/0");
  
  if (!childKey.privateKey || !childKey.publicKey) {
    throw new Error("Failed to derive keys");
  }
  
  const uncompressedPubKey = uncompressPublicKey(childKey.publicKey);
  const pubKeyWithoutPrefix = uncompressedPubKey.slice(1);
  const hash = keccak_256(pubKeyWithoutPrefix);
  const address = bytesToHex(hash.slice(-20));
  return `0x${address}` as `0x${string}`;
}

function uncompressPublicKey(compressedKey: Uint8Array): Uint8Array {
  if (compressedKey.length === 65) {
    return compressedKey;
  }
  
  const p = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F");
  const prefix = compressedKey[0];
  const x = BigInt("0x" + bytesToHex(compressedKey.slice(1)));
  
  const ySquared = (modPow(x, 3n, p) + 7n) % p;
  let y = modPow(ySquared, (p + 1n) / 4n, p);
  
  const isEven = (y & 1n) === 0n;
  const needsEven = prefix === 0x02;
  
  if (isEven !== needsEven) {
    y = p - y;
  }
  
  const result = new Uint8Array(65);
  result[0] = 0x04;
  const xBytes = hexToBytes(x.toString(16).padStart(64, "0"));
  const yBytes = hexToBytes(y.toString(16).padStart(64, "0"));
  result.set(xBytes, 1);
  result.set(yBytes, 33);
  
  return result;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp & 1n) {
      result = (result * base) % mod;
    }
    exp = exp >> 1n;
    base = (base * base) % mod;
  }
  return result;
}

async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function setSecureItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

async function deleteSecureItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

async function loadVaultMeta(): Promise<{ wallets: WalletRecord[]; activeWalletId: string | null }> {
  const meta = await AsyncStorage.getItem(STORAGE_KEYS.VAULT_META);
  if (meta) {
    return JSON.parse(meta);
  }
  return { wallets: [], activeWalletId: null };
}

async function saveVaultMeta(wallets: WalletRecord[], activeWalletId: string | null): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.VAULT_META, JSON.stringify({ wallets, activeWalletId }));
}

export function generateMnemonic(): string {
  return bip39.generateMnemonic(wordlist, 128);
}

export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic, wordlist);
}

export function deriveAddress(mnemonic: string): `0x${string}` {
  return mnemonicToAddress(mnemonic);
}

export function deriveMultiChainAddresses(mnemonic: string): MultiChainAddresses {
  const evmAddress = mnemonicToAddress(mnemonic);
  const solanaAddress = deriveSolanaAddress(mnemonic);
  return {
    evm: evmAddress,
    solana: solanaAddress,
  };
}

function isValidVaultFormat(vault: unknown): vault is EncryptedVault {
  if (!vault || typeof vault !== "object") return false;
  const v = vault as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.salt === "string" &&
    v.salt.length > 0 &&
    typeof v.iv === "string" &&
    v.iv.length > 0 &&
    typeof v.ciphertext === "string" &&
    v.ciphertext.length > 0
  );
}

export async function hasExistingVault(): Promise<boolean> {
  const vault = await getSecureItem(STORAGE_KEYS.VAULT);
  return vault !== null;
}

export async function isVaultCorrupted(): Promise<boolean> {
  const vaultJson = await getSecureItem(STORAGE_KEYS.VAULT);
  if (!vaultJson) return false;
  
  try {
    const vault = JSON.parse(vaultJson);
    return !isValidVaultFormat(vault);
  } catch {
    return true;
  }
}

export async function repairCorruptedVault(): Promise<void> {
  if (__DEV__) {
    console.log("[WalletEngine] Repairing corrupted vault - clearing all wallet data");
  }
  await deleteVault();
}

export async function createWallet(
  mnemonic: string,
  name: string,
  pin: string
): Promise<WalletRecord> {
  if (!validateMnemonic(mnemonic)) {
    throw new Error("Invalid mnemonic");
  }
  
  const addresses = deriveMultiChainAddresses(mnemonic);
  const walletId = `wallet_${Date.now()}`;
  
  const wallet: WalletRecord = {
    id: walletId,
    name,
    address: addresses.evm,
    addresses,
    createdAt: Date.now(),
  };
  
  const existingVault = await getSecureItem(STORAGE_KEYS.VAULT);
  let secrets: DecryptedSecrets;
  let wallets: WalletRecord[];
  
  if (existingVault && cachedSecrets) {
    secrets = { ...cachedSecrets, mnemonics: { ...cachedSecrets.mnemonics, [walletId]: mnemonic } };
    const meta = await loadVaultMeta();
    wallets = [...meta.wallets, wallet];
  } else {
    secrets = { mnemonics: { [walletId]: mnemonic } };
    wallets = [wallet];
  }
  
  const encryptedVault = await encryptSecrets(secrets, pin);
  await setSecureItem(STORAGE_KEYS.VAULT, JSON.stringify(encryptedVault));
  await saveVaultMeta(wallets, walletId);
  
  const pinHash = bytesToHex(sha256(new TextEncoder().encode(pin)));
  await setSecureItem(STORAGE_KEYS.PIN_HASH, pinHash);
  
  cachedSecrets = secrets;
  isVaultUnlocked = true;
  
  return wallet;
}

export async function importWallet(
  mnemonic: string,
  name: string,
  pin: string
): Promise<WalletRecord> {
  const normalizedMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  
  if (!validateMnemonic(normalizedMnemonic)) {
    throw new Error("Invalid mnemonic. Please check your words and try again.");
  }
  
  return createWallet(normalizedMnemonic, name, pin);
}

export class VaultCorruptedError extends Error {
  code = "VAULT_CORRUPTED";
  constructor() {
    super("Your wallet data appears to be corrupted. Please restore from your backup seed phrase.");
    this.name = "VaultCorruptedError";
  }
}

export async function unlockWithPin(pin: string): Promise<boolean> {
  const vaultJson = await getSecureItem(STORAGE_KEYS.VAULT);
  if (!vaultJson) {
    if (__DEV__) {
      console.log("[WalletEngine] unlockWithPin: No vault found");
    }
    return false;
  }
  
  let vault: unknown;
  try {
    vault = JSON.parse(vaultJson);
  } catch {
    if (__DEV__) {
      console.log("[WalletEngine] unlockWithPin: Failed to parse vault JSON");
    }
    throw new VaultCorruptedError();
  }
  
  if (!isValidVaultFormat(vault)) {
    if (__DEV__) {
      console.log("[WalletEngine] unlockWithPin: Vault has invalid format", vault);
    }
    throw new VaultCorruptedError();
  }
  
  const secrets = await decryptSecrets(vault, pin);
  
  if (secrets) {
    if (__DEV__) {
      console.log("[WalletEngine] unlockWithPin: Successfully decrypted vault", {
        walletCount: Object.keys(secrets.mnemonics).length,
      });
    }
    cachedSecrets = secrets;
    isVaultUnlocked = true;
    return true;
  }
  
  if (__DEV__) {
    console.log("[WalletEngine] unlockWithPin: Failed to decrypt (wrong PIN?)");
  }
  return false;
}

export function lock(): void {
  cachedSecrets = null;
  isVaultUnlocked = false;
}

export function isUnlocked(): boolean {
  return isVaultUnlocked;
}

export async function listWallets(): Promise<WalletRecord[]> {
  const meta = await loadVaultMeta();
  return meta.wallets;
}

export async function getActiveWallet(): Promise<WalletRecord | null> {
  const meta = await loadVaultMeta();
  if (!meta.activeWalletId || meta.wallets.length === 0) {
    return null;
  }
  return meta.wallets.find(w => w.id === meta.activeWalletId) || meta.wallets[0];
}

export async function setActiveWalletById(walletId: string): Promise<void> {
  const meta = await loadVaultMeta();
  meta.activeWalletId = walletId;
  await saveVaultMeta(meta.wallets, walletId);
}

export async function getMnemonic(walletId: string): Promise<string | null> {
  if (__DEV__) {
    console.log("[WalletEngine] getMnemonic called", {
      walletId,
      isUnlocked: isVaultUnlocked,
      hasCachedSecrets: !!cachedSecrets,
      hasSecretForWallet: cachedSecrets ? !!cachedSecrets.mnemonics[walletId] : false,
    });
  }
  
  if (!cachedSecrets) {
    if (__DEV__) {
      console.log("[WalletEngine] getMnemonic returning null - no cached secrets");
    }
    return null;
  }
  return cachedSecrets.mnemonics[walletId] || null;
}

export class WalletLockedError extends Error {
  code = "WALLET_LOCKED";
  constructor() {
    super("Wallet is locked. Please unlock first.");
    this.name = "WalletLockedError";
  }
}

export function requireUnlocked(): void {
  if (!isVaultUnlocked || !cachedSecrets) {
    throw new WalletLockedError();
  }
}

export async function getActiveWalletMnemonic(): Promise<string> {
  requireUnlocked();
  
  const meta = await loadVaultMeta();
  if (!meta.activeWalletId) {
    throw new Error("No active wallet selected");
  }
  
  const mnemonic = cachedSecrets!.mnemonics[meta.activeWalletId];
  if (!mnemonic) {
    throw new Error("Mnemonic not found for active wallet");
  }
  
  return mnemonic;
}

export async function deleteVault(): Promise<void> {
  await deleteSecureItem(STORAGE_KEYS.VAULT);
  await deleteSecureItem(STORAGE_KEYS.PIN_HASH);
  await AsyncStorage.removeItem(STORAGE_KEYS.VAULT_META);
  cachedSecrets = null;
  isVaultUnlocked = false;
}

export async function verifyPin(pin: string): Promise<boolean> {
  const storedHash = await getSecureItem(STORAGE_KEYS.PIN_HASH);
  if (!storedHash) {
    return false;
  }
  const inputHash = bytesToHex(sha256(new TextEncoder().encode(pin)));
  return inputHash === storedHash;
}

export async function hasVault(): Promise<boolean> {
  const vaultJson = await getSecureItem(STORAGE_KEYS.VAULT);
  return vaultJson !== null;
}
