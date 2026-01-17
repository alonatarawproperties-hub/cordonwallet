import Constants from "expo-constants";
import { PublicKey } from "@solana/web3.js";

export const CORDON_TREASURY_NAME = "Cordon Treasury";

const FALLBACK_SOL_TREASURY = "6pcN26cpKbWmGyRn8DgRjqRzpBW2CFp8PK5wZ9gTArpE";

function validateSolanaAddress(addr: string): string {
  if (!addr || addr.length < 32) return "";
  try {
    new PublicKey(addr);
    return addr;
  } catch {
    if (__DEV__) {
      console.warn("[Treasury] Invalid Solana address:", addr);
    }
    return "";
  }
}

export function getCordonSolTreasury(): string {
  const expoConfig = Constants.expoConfig?.extra?.cordonSolTreasury;
  if (expoConfig) {
    const validated = validateSolanaAddress(expoConfig);
    if (validated) return validated;
  }

  const manifest2 = (Constants as any).manifest2?.extra?.cordonSolTreasury;
  if (manifest2) {
    const validated = validateSolanaAddress(manifest2);
    if (validated) return validated;
  }

  const manifest = (Constants as any).manifest?.extra?.cordonSolTreasury;
  if (manifest) {
    const validated = validateSolanaAddress(manifest);
    if (validated) return validated;
  }

  return validateSolanaAddress(FALLBACK_SOL_TREASURY);
}

export function getTreasuryName(): string {
  return (
    Constants.expoConfig?.extra?.cordonTreasuryName ||
    (Constants as any).manifest2?.extra?.cordonTreasuryName ||
    (Constants as any).manifest?.extra?.cordonTreasuryName ||
    CORDON_TREASURY_NAME
  );
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export function isTreasuryConfigured(): boolean {
  return !!getCordonSolTreasury();
}
