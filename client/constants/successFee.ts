import { SwapSpeed } from "./solanaSwap";

export const CORDON_FEE_WALLET_SOLANA = process.env.EXPO_PUBLIC_CORDON_FEE_WALLET || "";

export const SUCCESS_FEE_LAMPORTS: Record<SwapSpeed, number> = {
  standard: 200_000,   // 0.00020 SOL
  fast: 350_000,       // 0.00035 SOL
  turbo: 600_000,      // 0.00060 SOL
};

export const SUCCESS_FEE_SOL: Record<SwapSpeed, string> = {
  standard: "0.00020",
  fast: "0.00035",
  turbo: "0.00060",
};

export function getSuccessFeeLamports(
  speedMode: SwapSpeed,
  isPro: boolean,
  enabled: boolean
): number {
  if (!enabled || isPro) {
    return 0;
  }
  return SUCCESS_FEE_LAMPORTS[speedMode] || 0;
}

export function getSuccessFeeSol(
  speedMode: SwapSpeed,
  isPro: boolean,
  enabled: boolean
): string {
  if (!enabled || isPro) {
    return "0";
  }
  return SUCCESS_FEE_SOL[speedMode] || "0";
}

export function isFeeWalletConfigured(): boolean {
  return !!CORDON_FEE_WALLET_SOLANA && CORDON_FEE_WALLET_SOLANA.length >= 32;
}
