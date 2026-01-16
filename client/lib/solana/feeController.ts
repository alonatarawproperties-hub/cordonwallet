import {
  TransactionInstruction,
  ComputeBudgetProgram,
  PublicKey,
} from "@solana/web3.js";
import {
  SwapSpeed,
  SPEED_CONFIGS,
  LAMPORTS_PER_SOL,
  ADV_MAX_CAP_SOL,
} from "@/constants/solanaSwap";

export interface FeeConfig {
  computeUnitPriceMicroLamports: number;
  computeUnitLimit: number;
  maxCapSol: number;
  maxCapLamports: number;
  estimatedFeeLamports: number;
  estimatedFeeSol: number;
}

const DEFAULT_COMPUTE_UNITS = 200_000;
const SWAP_COMPUTE_UNITS = 400_000;

export function calculateFeeConfig(
  mode: SwapSpeed,
  customCapSol?: number,
  estimatedComputeUnits?: number
): FeeConfig {
  const config = SPEED_CONFIGS[mode];
  const maxCapSol = Math.min(customCapSol ?? config.capSol, ADV_MAX_CAP_SOL);
  const maxCapLamports = Math.floor(maxCapSol * LAMPORTS_PER_SOL);
  const computeUnits = estimatedComputeUnits ?? SWAP_COMPUTE_UNITS;
  
  let multiplier: number;
  switch (mode) {
    case "standard":
      multiplier = 1;
      break;
    case "fast":
      multiplier = 3;
      break;
    case "turbo":
      multiplier = 8;
      break;
  }
  
  const baseRateMicroLamports = 10_000;
  let computeUnitPriceMicroLamports = baseRateMicroLamports * multiplier;
  
  const estimatedFeeLamports = Math.ceil(
    (computeUnitPriceMicroLamports * computeUnits) / 1_000_000
  );
  
  if (estimatedFeeLamports > maxCapLamports) {
    computeUnitPriceMicroLamports = Math.floor(
      (maxCapLamports * 1_000_000) / computeUnits
    );
  }
  
  const actualFeeLamports = Math.ceil(
    (computeUnitPriceMicroLamports * computeUnits) / 1_000_000
  );
  
  return {
    computeUnitPriceMicroLamports,
    computeUnitLimit: computeUnits,
    maxCapSol,
    maxCapLamports,
    estimatedFeeLamports: actualFeeLamports,
    estimatedFeeSol: actualFeeLamports / LAMPORTS_PER_SOL,
  };
}

export function createComputeBudgetInstructions(
  feeConfig: FeeConfig
): TransactionInstruction[] {
  const instructions: TransactionInstruction[] = [];
  
  instructions.push(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: feeConfig.computeUnitLimit,
    })
  );
  
  instructions.push(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: feeConfig.computeUnitPriceMicroLamports,
    })
  );
  
  return instructions;
}

export function extractComputeBudgetFromTx(
  instructions: TransactionInstruction[]
): { hasLimit: boolean; hasPrice: boolean; limitIndex: number; priceIndex: number } {
  const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
  
  let hasLimit = false;
  let hasPrice = false;
  let limitIndex = -1;
  let priceIndex = -1;
  
  instructions.forEach((ix, index) => {
    if (ix.programId.toBase58() === COMPUTE_BUDGET_PROGRAM) {
      const instructionType = ix.data[0];
      if (instructionType === 2) {
        hasLimit = true;
        limitIndex = index;
      } else if (instructionType === 3) {
        hasPrice = true;
        priceIndex = index;
      }
    }
  });
  
  return { hasLimit, hasPrice, limitIndex, priceIndex };
}

export function formatFeeDisplay(feeSol: number, usdPrice?: number): string {
  const solStr = feeSol < 0.0001 
    ? "<0.0001 SOL" 
    : `${feeSol.toFixed(4)} SOL`;
  
  if (usdPrice) {
    const usdValue = feeSol * usdPrice;
    const usdStr = usdValue < 0.01 
      ? "<$0.01" 
      : `$${usdValue.toFixed(2)}`;
    return `${solStr} (${usdStr})`;
  }
  
  return solStr;
}

export function getSpeedLabel(mode: SwapSpeed): string {
  return SPEED_CONFIGS[mode].label;
}

export function getSpeedDescription(mode: SwapSpeed): string {
  return SPEED_CONFIGS[mode].description;
}

export function validateCapSol(capSol: number): {
  valid: boolean;
  warning?: string;
  error?: string;
} {
  if (capSol < 0) {
    return { valid: false, error: "Cap cannot be negative" };
  }
  
  if (capSol > ADV_MAX_CAP_SOL) {
    return { 
      valid: false, 
      error: `Cap cannot exceed ${ADV_MAX_CAP_SOL} SOL` 
    };
  }
  
  if (capSol > 0.01) {
    return { 
      valid: true, 
      warning: `High fee cap: ${capSol.toFixed(4)} SOL. This may result in expensive transactions.`
    };
  }
  
  return { valid: true };
}
