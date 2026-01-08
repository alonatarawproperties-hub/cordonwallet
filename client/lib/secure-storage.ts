import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SEED_PREFIX = "@shieldwallet/seed/";

export async function saveSeedPhrase(walletId: string, seedPhrase: string[]): Promise<void> {
  const key = `${SEED_PREFIX}${walletId}`;
  const value = JSON.stringify(seedPhrase);
  
  if (Platform.OS === "web") {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.error("Failed to save seed phrase to localStorage:", error);
      throw error;
    }
  } else {
    try {
      await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED,
      });
    } catch (error) {
      console.error("Failed to save seed phrase to SecureStore:", error);
      throw error;
    }
  }
}

export async function getSeedPhrase(walletId: string): Promise<string[] | null> {
  const key = `${SEED_PREFIX}${walletId}`;
  
  if (Platform.OS === "web") {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error("Failed to get seed phrase from localStorage:", error);
      return null;
    }
  } else {
    try {
      const value = await SecureStore.getItemAsync(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error("Failed to get seed phrase from SecureStore:", error);
      return null;
    }
  }
}

export async function deleteSeedPhrase(walletId: string): Promise<void> {
  const key = `${SEED_PREFIX}${walletId}`;
  
  if (Platform.OS === "web") {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error("Failed to delete seed phrase from localStorage:", error);
    }
  } else {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      console.error("Failed to delete seed phrase from SecureStore:", error);
    }
  }
}

export async function hasSeedPhrase(walletId: string): Promise<boolean> {
  const seedPhrase = await getSeedPhrase(walletId);
  return seedPhrase !== null && seedPhrase.length > 0;
}
