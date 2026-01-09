import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { keccak_256 } from "@noble/hashes/sha3";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export interface WalletRecord {
  id: string;
  name: string;
  address: `0x${string}`;
  createdAt: number;
}

interface EncryptedVault {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
}

interface StoredVault {
  version: 1;
  wallets: WalletRecord[];
  activeWalletId: string | null;
  encryptedVault: EncryptedVault | null;
}

interface DecryptedSecrets {
  mnemonics: Record<string, string>;
}

const STORAGE_KEYS = {
  VAULT: "cordon_vault",
  PIN_HASH: "cordon_pin_hash",
  VAULT_META: "@cordon/vault_meta",
};

const PBKDF2_ITERATIONS = 150000;

let cachedSecrets: DecryptedSecrets | null = null;
let isVaultUnlocked = false;

function deriveKeyFromPin(pin: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, pin, salt, { c: PBKDF2_ITERATIONS, dkLen: 32 });
}

function encryptSecrets(secrets: DecryptedSecrets, pin: string): EncryptedVault {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKeyFromPin(pin, salt);
  
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

function decryptSecrets(vault: EncryptedVault, pin: string): DecryptedSecrets | null {
  try {
    const salt = hexToBytes(vault.salt);
    const iv = hexToBytes(vault.iv);
    const ciphertext = hexToBytes(vault.ciphertext);
    const key = deriveKeyFromPin(pin, salt);
    
    const cipher = gcm(key, iv);
    const plaintext = cipher.decrypt(ciphertext);
    const json = new TextDecoder().decode(plaintext);
    
    return JSON.parse(json);
  } catch (error) {
    console.error("Failed to decrypt vault:", error);
    return null;
  }
}

function privateKeyToAddress(privateKey: Uint8Array): `0x${string}` {
  const { getPublicKey } = require("@noble/secp256k1");
  const publicKey = getPublicKey(privateKey, false).slice(1);
  const hash = keccak_256(publicKey);
  const address = bytesToHex(hash.slice(-20));
  return `0x${address}` as `0x${string}`;
}

function mnemonicToAddress(mnemonic: string): `0x${string}` {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const childKey = hdKey.derive("m/44'/60'/0'/0/0");
  
  if (!childKey.privateKey) {
    throw new Error("Failed to derive private key");
  }
  
  return privateKeyToAddress(childKey.privateKey);
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

export async function hasExistingVault(): Promise<boolean> {
  const vault = await getSecureItem(STORAGE_KEYS.VAULT);
  return vault !== null;
}

export async function createWallet(
  mnemonic: string,
  name: string,
  pin: string
): Promise<WalletRecord> {
  if (!validateMnemonic(mnemonic)) {
    throw new Error("Invalid mnemonic");
  }
  
  const address = deriveAddress(mnemonic);
  const walletId = `wallet_${Date.now()}`;
  
  const wallet: WalletRecord = {
    id: walletId,
    name,
    address,
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
  
  const encryptedVault = encryptSecrets(secrets, pin);
  await setSecureItem(STORAGE_KEYS.VAULT, JSON.stringify(encryptedVault));
  await saveVaultMeta(wallets, walletId);
  
  const pinHash = bytesToHex(sha256(pin));
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

export async function unlockWithPin(pin: string): Promise<boolean> {
  const vaultJson = await getSecureItem(STORAGE_KEYS.VAULT);
  if (!vaultJson) {
    return false;
  }
  
  const vault: EncryptedVault = JSON.parse(vaultJson);
  const secrets = decryptSecrets(vault, pin);
  
  if (secrets) {
    cachedSecrets = secrets;
    isVaultUnlocked = true;
    return true;
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

export async function setActiveWallet(walletId: string): Promise<void> {
  const meta = await loadVaultMeta();
  meta.activeWalletId = walletId;
  await saveVaultMeta(meta.wallets, walletId);
}

export async function getMnemonic(walletId: string): Promise<string | null> {
  if (!cachedSecrets) {
    return null;
  }
  return cachedSecrets.mnemonics[walletId] || null;
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
  const inputHash = bytesToHex(sha256(pin));
  return inputHash === storedHash;
}
