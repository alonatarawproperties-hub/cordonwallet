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
import { privateKeyToAccount } from "viem/accounts";
import * as nacl from "tweetnacl";
import bs58 from "bs58";

// Check if native crypto is available (Web Crypto API)
const hasNativeCrypto = typeof globalThis.crypto?.subtle?.deriveBits === "function";

export interface MultiChainAddresses {
  evm: `0x${string}`;
  solana: string;
}

export type WalletType = "multi-chain" | "solana-only";

export interface WalletRecord {
  id: string;
  name: string;
  address: `0x${string}`;
  addresses: MultiChainAddresses;
  walletType: WalletType;
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
  privateKeys?: Record<string, { type: "evm" | "solana"; key: string }>;
}

const STORAGE_KEYS = {
  VAULT: "cordon_vault",
  PIN_HASH: "cordon_pin_hash",
  VAULT_META: "@cordon/vault_meta",
  BIOMETRIC_PIN: "cordon_biometric_pin",
  CACHED_VAULT_KEY: "cordon_cached_vault_key",
};

const PBKDF2_ITERATIONS = 100000;

let cachedSecrets: DecryptedSecrets | null = null;
let isVaultUnlocked = false;

// Cache the vault key in SecureStore for fast subsequent unlocks
async function cacheVaultKey(key: Uint8Array): Promise<void> {
  try {
    await setSecureItem(STORAGE_KEYS.CACHED_VAULT_KEY, bytesToHex(key));
  } catch (err) {
    console.warn("[WalletEngine] Failed to cache vault key:", err);
  }
}

// Retrieve cached vault key for fast unlock
async function getCachedVaultKey(): Promise<Uint8Array | null> {
  try {
    const keyHex = await getSecureItem(STORAGE_KEYS.CACHED_VAULT_KEY);
    if (keyHex) {
      return hexToBytes(keyHex);
    }
  } catch (err) {
    console.warn("[WalletEngine] Failed to get cached vault key:", err);
  }
  return null;
}

// Clear cached vault key (on logout/lock)
async function clearCachedVaultKey(): Promise<void> {
  try {
    await deleteSecureItem(STORAGE_KEYS.CACHED_VAULT_KEY);
  } catch (err) {
    console.warn("[WalletEngine] Failed to clear cached vault key:", err);
  }
}

// Fast decrypt using cached key (no PBKDF2)
async function decryptSecretsWithKey(vault: EncryptedVault, key: Uint8Array): Promise<DecryptedSecrets | null> {
  try {
    const iv = hexToBytes(vault.iv);
    const ciphertext = hexToBytes(vault.ciphertext);
    
    const cipher = gcm(key, iv);
    const plaintext = cipher.decrypt(ciphertext);
    const json = new TextDecoder().decode(plaintext);
    
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Fast native PBKDF2 using Web Crypto API
async function deriveKeyFromPinNative(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const pinBytes = encoder.encode(pin);
  
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    pinBytes,
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  
  // Create a new ArrayBuffer copy to satisfy TypeScript's BufferSource type
  const saltBuffer = new Uint8Array(salt).buffer;
  
  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256 // 32 bytes * 8 bits
  );
  
  return new Uint8Array(derivedBits);
}

// Fallback to JS implementation (slower)
function deriveKeyFromPinJS(pin: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, pin, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 });
}

// Use native crypto when available for speed
async function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  if (hasNativeCrypto) {
    return deriveKeyFromPinNative(pin, salt);
  }
  // Fallback to JS (wrapped in setTimeout to not block UI completely)
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(deriveKeyFromPinJS(pin, salt));
      } catch (e) {
        reject(e);
      }
    }, 0);
  });
}

async function encryptSecrets(secrets: DecryptedSecrets, pin: string): Promise<EncryptedVault> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  
  const key = await deriveKeyFromPin(pin, salt);
  
  const plaintext = new TextEncoder().encode(JSON.stringify(secrets));
  const cipher = gcm(key, iv);
  const ciphertext = cipher.encrypt(plaintext);
  
  // Cache the new key for fast unlocks
  await cacheVaultKey(key);
  
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
    
    const key = await deriveKeyFromPin(pin, salt);
    
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

export async function savePinForBiometrics(pin: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return false;
  }
  
  try {
    const canUseBiometric = await SecureStore.canUseBiometricAuthentication();
    if (!canUseBiometric) {
      if (__DEV__) {
        console.log("[WalletEngine] Biometric authentication not available");
      }
      return false;
    }
    
    await SecureStore.setItemAsync(STORAGE_KEYS.BIOMETRIC_PIN, pin, {
      requireAuthentication: true,
      authenticationPrompt: "Enable biometric unlock for Cordon",
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    
    if (__DEV__) {
      console.log("[WalletEngine] PIN saved for biometric unlock");
    }
    return true;
  } catch (error) {
    if (__DEV__) {
      console.log("[WalletEngine] Failed to save PIN for biometrics:", error);
    }
    return false;
  }
}

export async function getPinWithBiometrics(): Promise<string | null> {
  if (Platform.OS === "web") {
    return null;
  }
  
  try {
    const pin = await SecureStore.getItemAsync(STORAGE_KEYS.BIOMETRIC_PIN, {
      requireAuthentication: true,
      authenticationPrompt: "Unlock Cordon",
    });
    return pin;
  } catch (error) {
    if (__DEV__) {
      console.log("[WalletEngine] Failed to get PIN with biometrics:", error);
    }
    return null;
  }
}

export async function hasBiometricPinEnabled(): Promise<boolean> {
  if (Platform.OS === "web") {
    return false;
  }
  
  try {
    const canUseBiometric = await SecureStore.canUseBiometricAuthentication();
    if (!canUseBiometric) {
      return false;
    }
    const pin = await SecureStore.getItemAsync(STORAGE_KEYS.BIOMETRIC_PIN);
    return pin !== null;
  } catch {
    return false;
  }
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (Platform.OS === "web") {
    return false;
  }
  
  try {
    return await SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

export async function disableBiometrics(): Promise<boolean> {
  if (Platform.OS === "web") {
    return false;
  }
  
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.BIOMETRIC_PIN);
    if (__DEV__) {
      console.log("[WalletEngine] Biometric unlock disabled");
    }
    return true;
  } catch (error) {
    if (__DEV__) {
      console.log("[WalletEngine] Failed to disable biometrics:", error);
    }
    return false;
  }
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
  pin: string,
  walletType: WalletType = "multi-chain"
): Promise<WalletRecord> {
  if (!validateMnemonic(mnemonic)) {
    throw new Error("Invalid mnemonic");
  }
  
  const addresses = deriveMultiChainAddresses(mnemonic);
  const walletId = `wallet_${Date.now()}`;
  
  const wallet: WalletRecord = {
    id: walletId,
    name,
    address: walletType === "solana-only" ? addresses.solana as `0x${string}` : addresses.evm,
    addresses,
    walletType,
    createdAt: Date.now(),
  };
  
  const existingVault = await getSecureItem(STORAGE_KEYS.VAULT);
  let secrets: DecryptedSecrets;
  let wallets: WalletRecord[];
  
  if (existingVault && cachedSecrets) {
    secrets = { ...cachedSecrets, mnemonics: { ...cachedSecrets.mnemonics, [walletId]: mnemonic } };
    const meta = await loadVaultMeta();
    
    // Check for duplicate wallets (same EVM or Solana address)
    const isDuplicate = meta.wallets.some(w => 
      (w.addresses?.evm && w.addresses.evm === addresses.evm) ||
      (w.addresses?.solana && w.addresses.solana === addresses.solana)
    );
    
    if (isDuplicate) {
      throw new Error("This wallet already exists. The same seed phrase was previously imported.");
    }
    
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
  
  await savePinForBiometrics(pin);
  
  cachedSecrets = secrets;
  isVaultUnlocked = true;
  
  return wallet;
}

export async function importWallet(
  mnemonic: string,
  name: string,
  pin: string,
  walletType: WalletType = "multi-chain"
): Promise<WalletRecord> {
  const normalizedMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  
  if (!validateMnemonic(normalizedMnemonic)) {
    throw new Error("Invalid mnemonic. Please check your words and try again.");
  }
  
  return createWallet(normalizedMnemonic, name, pin, walletType);
}

export class VaultCorruptedError extends Error {
  code = "VAULT_CORRUPTED";
  constructor() {
    super("Your wallet data appears to be corrupted. Please restore from your backup seed phrase.");
    this.name = "VaultCorruptedError";
  }
}

export async function unlockWithPin(pin: string): Promise<boolean> {
  // Step 1: Verify PIN hash first (fast - just SHA-256)
  const pinValid = await verifyPin(pin);
  if (!pinValid) {
    if (__DEV__) {
      console.log("[WalletEngine] unlockWithPin: PIN verification failed");
    }
    return false;
  }
  
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
  
  // Step 2: Try fast path with cached vault key
  const cachedKey = await getCachedVaultKey();
  if (cachedKey) {
    const secrets = await decryptSecretsWithKey(vault, cachedKey);
    if (secrets) {
      if (__DEV__) {
        console.log("[WalletEngine] unlockWithPin: Fast unlock with cached key", {
          walletCount: Object.keys(secrets.mnemonics).length,
        });
      }
      cachedSecrets = secrets;
      isVaultUnlocked = true;
      return true;
    }
    // Cached key didn't work (maybe vault was re-encrypted), clear it
    await clearCachedVaultKey();
  }
  
  // Step 3: Slow path - derive key with PBKDF2
  if (__DEV__) {
    console.log("[WalletEngine] unlockWithPin: Slow path - deriving key with PBKDF2");
  }
  const salt = hexToBytes(vault.salt);
  const key = await deriveKeyFromPin(pin, salt);
  const secrets = await decryptSecretsWithKey(vault, key);
  
  if (secrets) {
    if (__DEV__) {
      console.log("[WalletEngine] unlockWithPin: Successfully decrypted vault", {
        walletCount: Object.keys(secrets.mnemonics).length,
      });
    }
    cachedSecrets = secrets;
    isVaultUnlocked = true;
    // Cache the key for fast unlocks next time
    await cacheVaultKey(key);
    return true;
  }
  
  if (__DEV__) {
    console.log("[WalletEngine] unlockWithPin: Failed to decrypt");
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
  
  // Deduplicate wallets by EVM address (keep first occurrence)
  const seen = new Set<string>();
  const uniqueWallets = meta.wallets.filter(w => {
    const key = w.addresses?.evm || w.address;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  
  // If duplicates were removed, save the cleaned list
  if (uniqueWallets.length < meta.wallets.length) {
    if (__DEV__) {
      console.log(`[WalletEngine] Removed ${meta.wallets.length - uniqueWallets.length} duplicate wallets`);
    }
    await saveVaultMeta(uniqueWallets, meta.activeWalletId);
  }
  
  return uniqueWallets;
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

export async function renameWallet(walletId: string, newName: string): Promise<void> {
  const meta = await loadVaultMeta();
  const wallet = meta.wallets.find(w => w.id === walletId);
  if (!wallet) {
    throw new Error("Wallet not found");
  }
  wallet.name = newName.trim();
  await saveVaultMeta(meta.wallets, meta.activeWalletId);
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
  await deleteSecureItem(STORAGE_KEYS.BIOMETRIC_PIN);
  await deleteSecureItem(STORAGE_KEYS.CACHED_VAULT_KEY);
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

export async function hasDevicePin(): Promise<boolean> {
  const storedHash = await getSecureItem(STORAGE_KEYS.PIN_HASH);
  const result = storedHash !== null;
  if (__DEV__) {
    console.log("[WalletEngine] hasDevicePin:", result);
  }
  return result;
}

export async function addWalletToExistingVault(
  mnemonic: string,
  name: string,
  walletType: WalletType = "multi-chain"
): Promise<WalletRecord> {
  if (!isVaultUnlocked || !cachedSecrets) {
    throw new WalletLockedError();
  }
  
  const normalizedMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  
  if (!bip39.validateMnemonic(normalizedMnemonic, wordlist)) {
    throw new Error("Invalid mnemonic");
  }
  
  const addresses = deriveMultiChainAddresses(normalizedMnemonic);
  const walletId = `wallet_${Date.now()}`;
  
  const wallet: WalletRecord = {
    id: walletId,
    name,
    address: walletType === "solana-only" ? addresses.solana as `0x${string}` : addresses.evm,
    addresses,
    walletType,
    createdAt: Date.now(),
  };
  
  const meta = await loadVaultMeta();
  
  const isDuplicate = meta.wallets.some(w => 
    (w.addresses?.evm && w.addresses.evm === addresses.evm) ||
    (w.addresses?.solana && w.addresses.solana === addresses.solana)
  );
  
  if (isDuplicate) {
    throw new Error("This wallet already exists. The same seed phrase was previously imported.");
  }
  
  const newSecrets: DecryptedSecrets = {
    ...cachedSecrets,
    mnemonics: { ...cachedSecrets.mnemonics, [walletId]: normalizedMnemonic }
  };
  
  const cachedKey = await getCachedVaultKey();
  if (!cachedKey) {
    throw new Error("Vault key not available. Please unlock with PIN first.");
  }
  
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(newSecrets));
  const cipher = gcm(cachedKey, iv);
  const ciphertext = cipher.encrypt(plaintext);
  
  const encryptedVault: EncryptedVault = {
    version: 1,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(ciphertext),
  };
  
  await setSecureItem(STORAGE_KEYS.VAULT, JSON.stringify(encryptedVault));
  await saveVaultMeta([...meta.wallets, wallet], walletId);
  
  cachedSecrets = newSecrets;
  
  if (__DEV__) {
    console.log("[WalletEngine] addWalletToExistingVault: Success", { walletId, name });
  }
  
  return wallet;
}

export async function addWalletFromPrivateKey(
  privateKey: string,
  chainType: "evm" | "solana",
  name: string
): Promise<WalletRecord> {
  if (!isVaultUnlocked || !cachedSecrets) {
    throw new WalletLockedError();
  }

  const walletId = `wallet_${Date.now()}`;
  let addresses: MultiChainAddresses;
  let normalizedKey: string;

  if (chainType === "evm") {
    let pkHex = privateKey.trim();
    if (pkHex.startsWith("0x")) {
      pkHex = pkHex.slice(2);
    }
    if (!/^[0-9a-fA-F]{64}$/.test(pkHex)) {
      throw new Error("Invalid EVM private key. Must be 64 hex characters.");
    }
    normalizedKey = pkHex.toLowerCase();
    
    const account = privateKeyToAccount(`0x${normalizedKey}`);
    addresses = {
      evm: account.address as `0x${string}`,
      solana: "",
    };
  } else {
    const trimmedKey = privateKey.trim();
    let secretKeyBytes: Uint8Array;
    
    if (trimmedKey.startsWith("[")) {
      try {
        const numbers: number[] = JSON.parse(trimmedKey);
        if (!Array.isArray(numbers) || numbers.length !== 64) {
          throw new Error("Invalid Solana key: JSON array must have exactly 64 numbers");
        }
        if (!numbers.every(n => typeof n === "number" && n >= 0 && n <= 255)) {
          throw new Error("Invalid Solana key: each number must be 0-255");
        }
        secretKeyBytes = Uint8Array.from(numbers);
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new Error("Invalid JSON format for Solana secret key");
        }
        throw e;
      }
    } else {
      try {
        secretKeyBytes = bs58.decode(trimmedKey);
      } catch {
        throw new Error("Invalid base58 Solana secret key");
      }
    }
    
    if (secretKeyBytes.length !== 64) {
      throw new Error(`Invalid Solana secret key length: expected 64 bytes, got ${secretKeyBytes.length}`);
    }
    
    const keypair = nacl.sign.keyPair.fromSecretKey(secretKeyBytes);
    const solanaAddress = bs58.encode(keypair.publicKey);
    normalizedKey = bs58.encode(secretKeyBytes);
    
    addresses = {
      evm: "" as `0x${string}`,
      solana: solanaAddress,
    };
  }

  const wallet: WalletRecord = {
    id: walletId,
    name,
    address: chainType === "evm" ? addresses.evm : addresses.solana as `0x${string}`,
    addresses,
    walletType: chainType === "evm" ? "multi-chain" : "solana-only",
    createdAt: Date.now(),
  };

  const meta = await loadVaultMeta();
  
  const isDuplicate = meta.wallets.some(w => {
    if (chainType === "evm") {
      return w.addresses?.evm && w.addresses.evm.toLowerCase() === addresses.evm.toLowerCase();
    }
    return w.addresses?.solana && w.addresses.solana === addresses.solana;
  });
  
  if (isDuplicate) {
    throw new Error("This wallet already exists. The same private key was previously imported.");
  }

  const newSecrets: DecryptedSecrets = {
    ...cachedSecrets,
    mnemonics: { ...cachedSecrets.mnemonics },
    privateKeys: { 
      ...(cachedSecrets.privateKeys || {}), 
      [walletId]: { type: chainType, key: normalizedKey } 
    }
  };

  const cachedKey = await getCachedVaultKey();
  if (!cachedKey) {
    throw new Error("Vault key not available. Please unlock with PIN first.");
  }

  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(newSecrets));
  const cipher = gcm(cachedKey, iv);
  const ciphertext = cipher.encrypt(plaintext);

  const encryptedVault: EncryptedVault = {
    version: 1,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(ciphertext),
  };

  await setSecureItem(STORAGE_KEYS.VAULT, JSON.stringify(encryptedVault));
  await saveVaultMeta([...meta.wallets, wallet], walletId);

  cachedSecrets = newSecrets;

  if (__DEV__) {
    console.log("[WalletEngine] addWalletFromPrivateKey: Success", { walletId, name, chainType });
  }

  return wallet;
}
