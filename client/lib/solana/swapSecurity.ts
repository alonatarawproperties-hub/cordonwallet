import {
  VersionedTransaction,
  TransactionMessage,
  PublicKey,
} from "@solana/web3.js";
import bs58 from "bs58";
import { ALLOWED_PROGRAM_IDS, JUPITER_PROGRAM_IDS } from "@/constants/solanaSwap";

export interface SwapSecurityResult {
  safe: boolean;
  warnings: string[];
  errors: string[];
  details: {
    feePayer: string;
    feePayerIsUser: boolean;
    programIds: string[];
    unknownPrograms: string[];
    hasJupiterProgram: boolean;
    destinationAccounts: string[];
  };
}

export function decodeAndValidateSwapTx(
  txBase64: string,
  expectedUserPubkey: string,
  expectedOutputMint?: string
): SwapSecurityResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const programIds: string[] = [];
  const unknownPrograms: string[] = [];
  const destinationAccounts: string[] = [];
  
  let feePayer = "";
  let feePayerIsUser = false;
  let hasJupiterProgram = false;
  
  try {
    const txBuffer = Buffer.from(txBase64, "base64");
    const transaction = VersionedTransaction.deserialize(txBuffer);
    
    const message = transaction.message;
    const staticKeys = message.staticAccountKeys;
    
    if (staticKeys.length > 0) {
      feePayer = staticKeys[0].toBase58();
      feePayerIsUser = feePayer.toLowerCase() === expectedUserPubkey.toLowerCase();
    }
    
    if (!feePayerIsUser) {
      errors.push(`Fee payer mismatch: expected ${expectedUserPubkey.slice(0, 8)}..., got ${feePayer.slice(0, 8)}...`);
    }
    
    const compiledInstructions = message.compiledInstructions;
    
    for (const ix of compiledInstructions) {
      const programId = staticKeys[ix.programIdIndex].toBase58();
      
      if (!programIds.includes(programId)) {
        programIds.push(programId);
      }
      
      if (JUPITER_PROGRAM_IDS.has(programId)) {
        hasJupiterProgram = true;
      }
      
      if (!ALLOWED_PROGRAM_IDS.has(programId)) {
        if (!unknownPrograms.includes(programId)) {
          unknownPrograms.push(programId);
        }
      }
      
      if (programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ||
          programId === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") {
        if (ix.data.length > 0 && ix.data[0] === 3) {
          const destIndex = ix.accountKeyIndexes[1];
          if (destIndex !== undefined && destIndex < staticKeys.length) {
            const dest = staticKeys[destIndex].toBase58();
            if (!destinationAccounts.includes(dest)) {
              destinationAccounts.push(dest);
            }
          }
        }
      }
    }
    
    if (unknownPrograms.length > 0) {
      errors.push(
        `Blocked for safety: unexpected program detected: ${unknownPrograms.map(p => p.slice(0, 8) + "...").join(", ")}`
      );
    }
    
    if (!hasJupiterProgram) {
      warnings.push("No Jupiter program detected in transaction. This may not be a Jupiter swap.");
    }
    
    if (transaction.signatures.length === 0) {
      warnings.push("Transaction has no signatures yet (expected for unsigned tx).");
    }
    
  } catch (error: any) {
    errors.push(`Failed to decode transaction: ${error.message}`);
  }
  
  return {
    safe: errors.length === 0,
    warnings,
    errors,
    details: {
      feePayer,
      feePayerIsUser,
      programIds,
      unknownPrograms,
      hasJupiterProgram,
      destinationAccounts,
    },
  };
}

export function validateSwapParams(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  userPubkey: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  try {
    new PublicKey(params.inputMint);
  } catch {
    errors.push("Invalid input token mint address");
  }
  
  try {
    new PublicKey(params.outputMint);
  } catch {
    errors.push("Invalid output token mint address");
  }
  
  try {
    new PublicKey(params.userPubkey);
  } catch {
    errors.push("Invalid user wallet address");
  }
  
  const amount = BigInt(params.amount);
  if (amount <= 0n) {
    errors.push("Amount must be greater than 0");
  }
  
  if (params.slippageBps < 0 || params.slippageBps > 10000) {
    errors.push("Slippage must be between 0 and 100%");
  }
  
  if (params.inputMint === params.outputMint) {
    errors.push("Input and output tokens cannot be the same");
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function isDrainerTransaction(txBase64: string): boolean {
  try {
    const txBuffer = Buffer.from(txBase64, "base64");
    const transaction = VersionedTransaction.deserialize(txBuffer);
    const message = transaction.message;
    const staticKeys = message.staticAccountKeys;
    
    for (const ix of message.compiledInstructions) {
      const programId = staticKeys[ix.programIdIndex].toBase58();
      
      if (programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ||
          programId === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") {
        const data = ix.data;
        if (data.length > 0) {
          const instructionType = data[0];
          if (instructionType === 6 || instructionType === 7) {
            return true;
          }
        }
      }
      
      if (programId === "11111111111111111111111111111111") {
        const data = ix.data;
        if (data.length >= 4) {
          const instructionType = data.slice(0, 4);
          if (instructionType[0] === 1 && instructionType[1] === 0 && 
              instructionType[2] === 0 && instructionType[3] === 0) {
            const numAccounts = ix.accountKeyIndexes.length;
            if (numAccounts === 2) {
              return true;
            }
          }
        }
      }
    }
    
    return false;
  } catch {
    return true;
  }
}
