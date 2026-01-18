import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export const SWAP_BUFFER_CONSTANTS = {
  BASE_FEE_LAMPORTS: 15_000,
  SAFETY_BUFFER_LAMPORTS: 500_000,
  WSOL_RENT_LAMPORTS: 2_500_000,
} as const;

export function estimateRequiredSolBufferLamports(
  priorityFeeCapLamports: number,
  outputIsSol: boolean
): number {
  const { BASE_FEE_LAMPORTS, SAFETY_BUFFER_LAMPORTS, WSOL_RENT_LAMPORTS } = SWAP_BUFFER_CONSTANTS;
  
  const rentReserve = outputIsSol ? WSOL_RENT_LAMPORTS : 0;
  
  return BASE_FEE_LAMPORTS + SAFETY_BUFFER_LAMPORTS + rentReserve + priorityFeeCapLamports;
}

export function formatBufferSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  return sol.toFixed(4).replace(/\.?0+$/, "") || "0";
}

export function hasEnoughSolForBuffer(
  solBalanceLamports: number,
  priorityFeeCapLamports: number,
  outputIsSol: boolean
): boolean {
  const required = estimateRequiredSolBufferLamports(priorityFeeCapLamports, outputIsSol);
  return solBalanceLamports >= required;
}
