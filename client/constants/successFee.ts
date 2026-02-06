import { SwapSpeed } from "./solanaSwap";
import { getCordonSolTreasury, isTreasuryConfigured } from "./treasury";

export const CORDON_FEE_WALLET_SOLANA = getCordonSolTreasury();

// Success fee disabled - replaced by Jupiter platform fee (atomic, 0.5%)
export const SUCCESS_FEE_LAMPORTS: Record<SwapSpeed, number> = {
  standard: 0,
  fast: 0,
  turbo: 0,
};

export const SUCCESS_FEE_SOL: Record<SwapSpeed, string> = {
  standard: "0",
  fast: "0",
  turbo: "0",
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
  return isTreasuryConfigured();
}
