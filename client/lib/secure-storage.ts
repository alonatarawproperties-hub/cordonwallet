import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SEED_PREFIX = "cordon_seed_";

// Security: saveSeedPhrase and getSeedPhrase have been removed.
// Seed phrases must ONLY be stored inside the encrypted vault (wallet-engine.ts).
// This file only retains deleteSeedPhrase for cleaning up any legacy data.

/**
 * Delete any legacy seed phrase data stored outside the vault.
 * This is kept solely for migration/cleanup purposes.
 */
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
