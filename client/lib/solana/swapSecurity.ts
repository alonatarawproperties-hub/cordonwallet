import {
  VersionedTransaction,
  TransactionMessage,
  PublicKey,
} from "@solana/web3.js";
import bs58 from "bs58";
import { ALLOWED_PROGRAM_IDS, JUPITER_PROGRAM_IDS, PUMP_PROGRAM_IDS } from "@/constants/solanaSwap";

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
    hasPumpProgram: boolean;
    destinationAccounts: string[];
  };
}

export function decodeAndValidateSwapTx(
  txBase64: string,
  expectedUserPubkey: string,
  expectedOutputMint?: string,
  routeType?: "jupiter" | "pump" | "none"
): SwapSecurityResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const programIds: string[] = [];
  const unknownPrograms: string[] = [];
  const destinationAccounts: string[] = [];
  
  let feePayer = "";
  let feePayerIsUser = false;
  let hasJupiterProgram = false;
  let hasPumpProgram = false;
  
  try {
    const txBuffer = Buffer.from(txBase64, "base64");
    const transaction = VersionedTransaction.deserialize(txBuffer);
    
    const message = transaction.message;
    const staticKeys = message.staticAccountKeys;
    
    const hasLuts = !!(message as any).addressTableLookups && (message as any).addressTableLookups.length > 0;
    
    if (staticKeys.length > 0) {
      feePayer = staticKeys[0].toBase58();
      feePayerIsUser = feePayer.toLowerCase() === expectedUserPubkey.toLowerCase();
    }
    
    if (!hasLuts) {
      if (!feePayerIsUser) {
        errors.push(`Fee payer mismatch: expected ${expectedUserPubkey.slice(0, 8)}..., got ${feePayer.slice(0, 8)}...`);
      }
    } else {
      if (!feePayerIsUser) {
        warnings.push("Fee payer cannot be fully verified client-side for LUT transactions.");
      }
    }
    
    const compiledInstructions = message.compiledInstructions;
    
    for (const ix of compiledInstructions) {
      if (ix.programIdIndex >= staticKeys.length) {
        continue;
      }
      const programId = staticKeys[ix.programIdIndex].toBase58();
      
      if (!programIds.includes(programId)) {
        programIds.push(programId);
      }
      
      if (JUPITER_PROGRAM_IDS.has(programId)) {
        hasJupiterProgram = true;
      }
      
      if (PUMP_PROGRAM_IDS.has(programId)) {
        hasPumpProgram = true;
      }
      
      if (!hasLuts) {
        if (!ALLOWED_PROGRAM_IDS.has(programId)) {
          if (!unknownPrograms.includes(programId)) {
            unknownPrograms.push(programId);
          }
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
    
    if (hasLuts) {
      warnings.push("Tx uses address lookup tables; client cannot fully verify program allowlist. Validation will be handled server-side.");
    } else {
      if (unknownPrograms.length > 0) {
        errors.push(
          `Blocked for safety: unexpected program detected: ${unknownPrograms.map(p => p.slice(0, 8) + "...").join(", ")}`
        );
      }
    }
    
    if (!hasJupiterProgram && !hasPumpProgram) {
      if (hasLuts) {
        warnings.push("Route program not detected in static keys (LUT tx); this can be normal.");
      } else if (routeType === "pump") {
        warnings.push("No Pump.fun program detected in transaction.");
      } else {
        warnings.push("No Jupiter program detected in transaction. This may not be a Jupiter swap.");
      }
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
      hasPumpProgram,
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

const SAFE_OWNERS = new Set([
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "ComputeBudget111111111111111111111111111111",
]);

export function isDrainerTransaction(txBase64: string, userPubkey: string): boolean {
  try {
    const txBuffer = Buffer.from(txBase64, "base64");
    const transaction = VersionedTransaction.deserialize(txBuffer);
    const message = transaction.message;
    const staticKeys = message.staticAccountKeys;
    const feePayer = staticKeys[0]?.toBase58() || "";
    
    for (const ix of message.compiledInstructions) {
      const programId = staticKeys[ix.programIdIndex].toBase58();
      const accounts = ix.accountKeyIndexes.map(i => staticKeys[i]?.toBase58() || "");
      
      if (programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ||
          programId === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") {
        const data = ix.data;
        if (data.length > 0 && data[0] === 6) {
          const currentAuthority = accounts[1];
          if (!currentAuthority || currentAuthority !== userPubkey) {
            continue;
          }
          
          const hasNewAuthority = data.length >= 3 && data[2] === 1;
          if (!hasNewAuthority) continue;
          
          let newAuthority: string | null = null;
          if (data.length >= 35) {
            try {
              newAuthority = new PublicKey(data.slice(3, 35)).toBase58();
            } catch {
              newAuthority = null;
            }
          }
          
          if (newAuthority && newAuthority !== userPubkey) {
            return true;
          }
        }
      }
      
      if (programId === "11111111111111111111111111111111") {
        const data = ix.data;
        if (data.length >= 4) {
          const instructionType = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
          if (instructionType === 1) {
            const targetAccount = accounts[0];
            if (!targetAccount) continue;
            
            const isUserAccount = targetAccount === userPubkey || targetAccount === feePayer;
            if (!isUserAccount) continue;
            
            let newOwner: string | null = null;
            if (data.length >= 36) {
              try {
                newOwner = new PublicKey(data.slice(4, 36)).toBase58();
              } catch {
                newOwner = null;
              }
            }
            
            if (!newOwner || !SAFE_OWNERS.has(newOwner)) {
              return true;
            }
          }
        }
      }
    }
    
    return false;
  } catch (err) {
    console.warn("[SwapSecurity] isDrainerTransaction error, allowing:", err);
    return false;
  }
}
