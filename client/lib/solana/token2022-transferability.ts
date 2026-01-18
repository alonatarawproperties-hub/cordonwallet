import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionTypes,
  ExtensionType,
  getMint,
} from "@solana/spl-token";

export interface MintTransferRules {
  program: "token" | "token2022";
  isNonTransferable: boolean;
  permanentDelegate: string | null;
  freezeAuthority: string | null;
  transferFeeEnabled: boolean;
  transferHookEnabled: boolean;
  rawExtensions?: ExtensionType[];
}

const TRANSFER_RULES_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function parsePermanentDelegateFromBuffer(data: Buffer): string | null {
  try {
    const PERMANENT_DELEGATE_TYPE = 12;
    const TLV_TYPE_SIZE = 2;
    const TLV_LENGTH_SIZE = 2;
    const MINT_SIZE = 82;

    if (data.length <= MINT_SIZE + 4) {
      return null;
    }

    let offset = MINT_SIZE;
    const accountType = data[offset];
    offset += 1;

    if (accountType !== 1) {
      return null;
    }

    while (offset + TLV_TYPE_SIZE + TLV_LENGTH_SIZE <= data.length) {
      const extType = data.readUInt16LE(offset);
      const extLen = data.readUInt16LE(offset + TLV_TYPE_SIZE);

      const dataStart = offset + TLV_TYPE_SIZE + TLV_LENGTH_SIZE;

      if (extType === PERMANENT_DELEGATE_TYPE && extLen >= 32) {
        const delegateBytes = data.slice(dataStart, dataStart + 32);
        const delegatePubkey = new PublicKey(delegateBytes);

        const isZero = delegateBytes.every((b: number) => b === 0);
        if (isZero) {
          return null;
        }

        return delegatePubkey.toBase58();
      }

      offset = dataStart + extLen;
    }

    return null;
  } catch {
    return null;
  }
}

async function getMintTransferRulesInternal(
  connection: Connection,
  mintAddress: string
): Promise<MintTransferRules> {
  const defaultRules: MintTransferRules = {
    program: "token",
    isNonTransferable: false,
    permanentDelegate: null,
    freezeAuthority: null,
    transferFeeEnabled: false,
    transferHookEnabled: false,
  };

  try {
    const mintPk = new PublicKey(mintAddress);
    const accountInfo = await connection.getAccountInfo(mintPk, "confirmed");

    if (!accountInfo) {
      console.log(`[Token2022 Transferability] Mint not found: ${mintAddress.slice(0, 8)}...`);
      return defaultRules;
    }

    const isToken2022 = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
    const isSplToken = accountInfo.owner.equals(TOKEN_PROGRAM_ID);

    if (!isToken2022 && !isSplToken) {
      console.log(`[Token2022 Transferability] Unknown program for mint: ${mintAddress.slice(0, 8)}...`);
      return defaultRules;
    }

    if (!isToken2022) {
      try {
        const mintInfo = await getMint(connection, mintPk, "confirmed", TOKEN_PROGRAM_ID);
        return {
          program: "token",
          isNonTransferable: false,
          permanentDelegate: null,
          freezeAuthority: mintInfo.freezeAuthority?.toBase58() || null,
          transferFeeEnabled: false,
          transferHookEnabled: false,
        };
      } catch {
        return defaultRules;
      }
    }

    const mintInfo = await getMint(connection, mintPk, "confirmed", TOKEN_2022_PROGRAM_ID);
    const extensions = getExtensionTypes(accountInfo.data);

    const isNonTransferable = extensions.includes(ExtensionType.NonTransferable);
    const hasPermanentDelegate = extensions.includes(ExtensionType.PermanentDelegate);
    const hasTransferHook = extensions.includes(ExtensionType.TransferHook);
    const hasTransferFee = extensions.includes(ExtensionType.TransferFeeConfig);

    let permanentDelegate: string | null = null;
    if (hasPermanentDelegate) {
      permanentDelegate = parsePermanentDelegateFromBuffer(accountInfo.data);
    }

    const rules: MintTransferRules = {
      program: "token2022",
      isNonTransferable,
      permanentDelegate,
      freezeAuthority: mintInfo.freezeAuthority?.toBase58() || null,
      transferFeeEnabled: hasTransferFee,
      transferHookEnabled: hasTransferHook,
      rawExtensions: extensions,
    };

    console.log(`[Token2022 Transferability] Mint ${mintAddress.slice(0, 8)}... rules:`, {
      program: rules.program,
      isNonTransferable: rules.isNonTransferable,
      permanentDelegate: rules.permanentDelegate?.slice(0, 8) || null,
      extensions: extensions.map((e) => ExtensionType[e]),
    });

    return rules;
  } catch (error) {
    console.error(`[Token2022 Transferability] Error analyzing mint:`, error);
    return defaultRules;
  }
}

export async function getMintTransferRules(
  connection: Connection,
  mintAddress: string
): Promise<MintTransferRules> {
  const fallback: MintTransferRules = {
    program: "token",
    isNonTransferable: false,
    permanentDelegate: null,
    freezeAuthority: null,
    transferFeeEnabled: false,
    transferHookEnabled: false,
  };

  return withTimeout(getMintTransferRulesInternal(connection, mintAddress), TRANSFER_RULES_TIMEOUT_MS, fallback);
}

export interface TransferabilityResult {
  canTransfer: boolean;
  reason: "allowed" | "non_transferable" | "delegate_only" | "unknown";
  title?: string;
  message?: string;
}

export function checkTransferability(
  rules: MintTransferRules,
  walletAddress: string
): TransferabilityResult {
  if (!rules.isNonTransferable) {
    return { canTransfer: true, reason: "allowed" };
  }

  if (rules.permanentDelegate) {
    const isDelegate = rules.permanentDelegate.toLowerCase() === walletAddress.toLowerCase();
    
    if (isDelegate) {
      return { 
        canTransfer: true, 
        reason: "allowed",
      };
    }

    return {
      canTransfer: false,
      reason: "delegate_only",
      title: "Transfers restricted",
      message: `This token uses a permanent delegate. Only the delegate wallet (${rules.permanentDelegate.slice(0, 4)}...${rules.permanentDelegate.slice(-4)}) can transfer it.`,
    };
  }

  return {
    canTransfer: false,
    reason: "non_transferable",
    title: "Token can't be transferred",
    message: "This token is non-transferable (Token-2022). It's bound to your wallet and cannot be sent to anyone.",
  };
}
