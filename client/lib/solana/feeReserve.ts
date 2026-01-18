import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export const FEE_CONSTANTS = {
  BASE_FEE_LAMPORTS: 5000,
  BASE_FEE_BUFFER_LAMPORTS: 5000,
  SAFETY_BUFFER_LAMPORTS: 200_000,
  ATA_RENT_LAMPORTS: 2_039_280,
  WSOL_TEMP_RENT_LAMPORTS: 2_100_000,
} as const;

export interface FeeReserveBreakdown {
  priorityFeeCap: number;
  networkBaseFee: number;
  ataRent: number;
  wsolTempRent: number;
  safetyBuffer: number;
  successFee: number;
}

export interface FeeReserveResult {
  reserveLamports: number;
  spendableLamports: number;
  breakdown: FeeReserveBreakdown;
}

export interface EstimateFeeReserveParams {
  solBalanceLamports: number;
  priorityCapLamports: number;
  needsAtaRent: boolean;
  isOutputSol?: boolean;
  successFeeLamports?: number;
  overrides?: Partial<typeof FEE_CONSTANTS>;
}

export function estimateFeeReserveLamports(params: EstimateFeeReserveParams): FeeReserveResult {
  const {
    solBalanceLamports,
    priorityCapLamports,
    needsAtaRent,
    isOutputSol = false,
    successFeeLamports = 0,
    overrides = {},
  } = params;

  const constants = { ...FEE_CONSTANTS, ...overrides };

  const breakdown: FeeReserveBreakdown = {
    priorityFeeCap: priorityCapLamports,
    networkBaseFee: constants.BASE_FEE_LAMPORTS + constants.BASE_FEE_BUFFER_LAMPORTS,
    ataRent: needsAtaRent ? constants.ATA_RENT_LAMPORTS : 0,
    wsolTempRent: isOutputSol ? constants.WSOL_TEMP_RENT_LAMPORTS : 0,
    safetyBuffer: constants.SAFETY_BUFFER_LAMPORTS,
    successFee: successFeeLamports,
  };

  const reserveLamports =
    breakdown.priorityFeeCap +
    breakdown.networkBaseFee +
    breakdown.ataRent +
    breakdown.wsolTempRent +
    breakdown.safetyBuffer +
    breakdown.successFee;

  const spendableLamports = Math.max(0, solBalanceLamports - reserveLamports);

  return {
    reserveLamports,
    spendableLamports,
    breakdown,
  };
}

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

export function lamportsToSolString(lamports: number, decimals: number = 6): string {
  const sol = lamportsToSol(lamports);
  return sol.toFixed(decimals).replace(/\.?0+$/, "") || "0";
}

export function solToLamports(sol: number): number {
  return Math.floor(sol * LAMPORTS_PER_SOL);
}

export function formatFeeBreakdown(breakdown: FeeReserveBreakdown): string[] {
  const lines: string[] = [];
  if (breakdown.priorityFeeCap > 0) {
    lines.push(`Priority fee cap: ${lamportsToSolString(breakdown.priorityFeeCap)} SOL`);
  }
  lines.push(`Network fee: ${lamportsToSolString(breakdown.networkBaseFee)} SOL`);
  if (breakdown.ataRent > 0) {
    lines.push(`Token account: ${lamportsToSolString(breakdown.ataRent)} SOL`);
  }
  if (breakdown.wsolTempRent > 0) {
    lines.push(`WSOL temp rent: ${lamportsToSolString(breakdown.wsolTempRent)} SOL`);
  }
  if (breakdown.successFee > 0) {
    lines.push(`Success fee: ${lamportsToSolString(breakdown.successFee)} SOL`);
  }
  lines.push(`Safety buffer: ${lamportsToSolString(breakdown.safetyBuffer)} SOL`);
  return lines;
}

if (__DEV__) {
  const testResult = estimateFeeReserveLamports({
    solBalanceLamports: 1_000_000_000,
    priorityCapLamports: 20_000_000,
    needsAtaRent: true,
  });
  console.log("[feeReserve] Test: 1 SOL, 0.02 cap, unknown output =>", {
    reserve: lamportsToSolString(testResult.reserveLamports),
    spendable: lamportsToSolString(testResult.spendableLamports),
    expected: "~0.9777 SOL spendable",
  });
}
