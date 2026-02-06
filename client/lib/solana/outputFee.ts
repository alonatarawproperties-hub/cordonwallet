import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  SystemProgram,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import { getCordonSolTreasury, isTreasuryConfigured } from "@/constants/treasury";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
// Output fee disabled - replaced by Jupiter platform fee (server-side, atomic, tamper-proof)
const OUTPUT_FEE_BPS = 0;

export interface AppendFeeResult {
  transaction: VersionedTransaction;
  feeAppended: boolean;
  feeAmountAtomic: bigint;
  reason?: string;
}

export async function appendOutputFeeInstruction(
  connection: Connection,
  originalTxBase64: string,
  userPubkey: PublicKey,
  outputMint: string,
  outAmountAtomic: string,
  addressLookupTableAccounts?: AddressLookupTableAccount[]
): Promise<AppendFeeResult> {
  const originalTxBuffer = Buffer.from(originalTxBase64, "base64");
  const originalTx = VersionedTransaction.deserialize(originalTxBuffer);
  
  if (!isTreasuryConfigured()) {
    if (__DEV__) console.log("[CordonFee] Treasury not configured, skipping fee");
    return { transaction: originalTx, feeAppended: false, feeAmountAtomic: 0n, reason: "Treasury not configured" };
  }
  
  const treasuryAddress = getCordonSolTreasury();
  if (!treasuryAddress) {
    if (__DEV__) console.log("[CordonFee] No treasury address, skipping fee");
    return { transaction: originalTx, feeAppended: false, feeAmountAtomic: 0n, reason: "No treasury address" };
  }
  
  const treasuryPubkey = new PublicKey(treasuryAddress);
  const outAmount = BigInt(outAmountAtomic);
  
  if (outAmount <= 0n) {
    return { transaction: originalTx, feeAppended: false, feeAmountAtomic: 0n, reason: "Zero output amount" };
  }
  
  const feeAmountAtomic = outAmount * BigInt(OUTPUT_FEE_BPS) / 10000n;
  
  if (feeAmountAtomic <= 0n) {
    return { transaction: originalTx, feeAppended: false, feeAmountAtomic: 0n, reason: "Fee amount too small" };
  }
  
  try {
    const feeInstructions = await buildFeeInstructions(
      connection,
      userPubkey,
      treasuryPubkey,
      outputMint,
      feeAmountAtomic,
      outAmount
    );
    
    if (feeInstructions.length === 0) {
      return { transaction: originalTx, feeAppended: false, feeAmountAtomic: 0n, reason: "No fee instructions generated" };
    }
    
    const modifiedTx = await appendInstructionsToVersionedTx(
      connection,
      originalTx,
      feeInstructions,
      addressLookupTableAccounts
    );
    
    if (__DEV__) {
      console.log("[CordonFee] Fee appended successfully:", {
        outputMint: outputMint.slice(0, 8) + "...",
        feeAmount: feeAmountAtomic.toString(),
        instructionsAdded: feeInstructions.length,
      });
    }
    
    return { transaction: modifiedTx, feeAppended: true, feeAmountAtomic };
    
  } catch (error: any) {
    if (__DEV__) console.warn("[CordonFee] Fee append failed:", error.message);
    return { transaction: originalTx, feeAppended: false, feeAmountAtomic: 0n, reason: error.message };
  }
}

async function buildFeeInstructions(
  connection: Connection,
  userPubkey: PublicKey,
  treasuryPubkey: PublicKey,
  outputMint: string,
  feeAmountAtomic: bigint,
  totalOutputAtomic: bigint
): Promise<TransactionInstruction[]> {
  const instructions: TransactionInstruction[] = [];
  
  if (outputMint === WSOL_MINT) {
    const safeFee = feeAmountAtomic < totalOutputAtomic ? feeAmountAtomic : totalOutputAtomic - 1n;
    if (safeFee <= 0n) return [];
    
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: userPubkey,
        toPubkey: treasuryPubkey,
        lamports: safeFee,
      })
    );
    return instructions;
  }
  
  const mintPubkey = new PublicKey(outputMint);
  const tokenProgramId = await detectTokenProgram(connection, mintPubkey);
  
  if (!tokenProgramId) {
    if (__DEV__) console.warn("[CordonFee] Unknown token program for mint:", outputMint);
    return [];
  }
  
  const userAta = getAssociatedTokenAddressSync(mintPubkey, userPubkey, false, tokenProgramId);
  const treasuryAta = getAssociatedTokenAddressSync(mintPubkey, treasuryPubkey, false, tokenProgramId);
  
  const treasuryAtaInfo = await connection.getAccountInfo(treasuryAta);
  if (!treasuryAtaInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        userPubkey,
        treasuryAta,
        treasuryPubkey,
        mintPubkey,
        tokenProgramId
      )
    );
  }
  
  instructions.push(
    createTransferInstruction(
      userAta,
      treasuryAta,
      userPubkey,
      feeAmountAtomic,
      [],
      tokenProgramId
    )
  );
  
  return instructions;
}

async function detectTokenProgram(
  connection: Connection,
  mintPubkey: PublicKey
): Promise<PublicKey | null> {
  try {
    const accountInfo = await connection.getAccountInfo(mintPubkey);
    if (!accountInfo) return null;
    
    const owner = accountInfo.owner.toBase58();
    
    if (owner === TOKEN_PROGRAM_ID.toBase58()) {
      return TOKEN_PROGRAM_ID;
    }
    if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) {
      return TOKEN_2022_PROGRAM_ID;
    }
    
    return null;
  } catch {
    return null;
  }
}

async function appendInstructionsToVersionedTx(
  connection: Connection,
  originalTx: VersionedTransaction,
  newInstructions: TransactionInstruction[],
  providedAltAccounts?: AddressLookupTableAccount[]
): Promise<VersionedTransaction> {
  const message = originalTx.message;
  
  let altAccounts = providedAltAccounts || [];
  
  if (altAccounts.length === 0 && message.addressTableLookups.length > 0) {
    const altKeys = message.addressTableLookups.map((lookup) => lookup.accountKey);
    const altInfos = await connection.getMultipleAccountsInfo(altKeys);
    
    altAccounts = altKeys
      .map((key, i) => {
        const info = altInfos[i];
        if (!info) return null;
        return new AddressLookupTableAccount({
          key,
          state: AddressLookupTableAccount.deserialize(info.data),
        });
      })
      .filter((acc): acc is AddressLookupTableAccount => acc !== null);
  }
  
  const decompiled = TransactionMessage.decompile(message, {
    addressLookupTableAccounts: altAccounts,
  });
  
  decompiled.instructions.push(...newInstructions);
  
  const recompiledMessage = decompiled.compileToV0Message(altAccounts);
  
  return new VersionedTransaction(recompiledMessage);
}
