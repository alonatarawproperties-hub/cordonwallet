import { Connection, PublicKey } from "@solana/web3.js";
import { 
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionTypes,
  ExtensionType,
  getMint,
} from "@solana/spl-token";

export interface Token2022InspectionResult {
  isToken2022: boolean;
  isNonTransferable: boolean;
  hasPermanentDelegate: boolean;
  permanentDelegate: string | null;
  hasTransferHook: boolean;
  hasTransferFee: boolean;
  hasFreezeAuthority: boolean;
  freezeAuthority: string | null;
  hasDefaultFrozenState: boolean;
  mintAuthority: string | null;
}

export async function inspectToken2022Mint(
  connection: Connection,
  mint: string
): Promise<Token2022InspectionResult> {
  const defaultResult: Token2022InspectionResult = {
    isToken2022: false,
    isNonTransferable: false,
    hasPermanentDelegate: false,
    permanentDelegate: null,
    hasTransferHook: false,
    hasTransferFee: false,
    hasFreezeAuthority: false,
    freezeAuthority: null,
    hasDefaultFrozenState: false,
    mintAuthority: null,
  };

  try {
    const mintPk = new PublicKey(mint);
    const accountInfo = await connection.getAccountInfo(mintPk, "confirmed");
    
    if (!accountInfo) {
      return defaultResult;
    }

    const isToken2022 = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
    
    if (!isToken2022) {
      try {
        const mintInfo = await getMint(connection, mintPk, "confirmed", TOKEN_PROGRAM_ID);
        return {
          ...defaultResult,
          isToken2022: false,
          hasFreezeAuthority: !!mintInfo.freezeAuthority,
          freezeAuthority: mintInfo.freezeAuthority?.toBase58() || null,
          mintAuthority: mintInfo.mintAuthority?.toBase58() || null,
        };
      } catch {
        return defaultResult;
      }
    }

    const mintInfo = await getMint(connection, mintPk, "confirmed", TOKEN_2022_PROGRAM_ID);
    const extensions = getExtensionTypes(accountInfo.data);

    const isNonTransferable = extensions.includes(ExtensionType.NonTransferable);
    const hasPermanentDelegate = extensions.includes(ExtensionType.PermanentDelegate);
    const hasTransferHook = extensions.includes(ExtensionType.TransferHook);
    const hasTransferFee = extensions.includes(ExtensionType.TransferFeeConfig);
    const hasDefaultFrozenState = extensions.includes(ExtensionType.DefaultAccountState);

    let permanentDelegate: string | null = null;
    
    if (hasPermanentDelegate) {
      permanentDelegate = parsePermanentDelegateFromBuffer(accountInfo.data);
    }

    return {
      isToken2022: true,
      isNonTransferable,
      hasPermanentDelegate,
      permanentDelegate,
      hasTransferHook,
      hasTransferFee,
      hasFreezeAuthority: !!mintInfo.freezeAuthority,
      freezeAuthority: mintInfo.freezeAuthority?.toBase58() || null,
      hasDefaultFrozenState,
      mintAuthority: mintInfo.mintAuthority?.toBase58() || null,
    };
  } catch (error) {
    console.error("[Token2022Guard] Inspection failed:", error);
    return defaultResult;
  }
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
        
        const isZero = delegateBytes.every(b => b === 0);
        if (isZero) {
          return null;
        }
        
        return delegatePubkey.toBase58();
      }
      
      offset = dataStart + extLen;
    }
    
    return null;
  } catch (error) {
    console.error("[Token2022Guard] Failed to parse permanent delegate:", error);
    return null;
  }
}

export interface TransferRestriction {
  canTransfer: boolean;
  restrictionType: "none" | "non_transferable" | "delegate_only" | "transfer_hook" | "frozen";
  message: string;
  delegateAddress?: string;
  isUserDelegate?: boolean;
}

export function evaluateTransferRestrictions(
  inspection: Token2022InspectionResult,
  userSolanaAddress: string
): TransferRestriction {
  if (!inspection.isToken2022) {
    return {
      canTransfer: true,
      restrictionType: "none",
      message: "",
    };
  }

  if (inspection.isNonTransferable) {
    if (inspection.hasPermanentDelegate && inspection.permanentDelegate) {
      const isUserDelegate = inspection.permanentDelegate.toLowerCase() === userSolanaAddress.toLowerCase();
      
      if (isUserDelegate) {
        return {
          canTransfer: true,
          restrictionType: "delegate_only",
          message: "You are the permanent delegate of this non-transferable token. Only you can transfer it.",
          delegateAddress: inspection.permanentDelegate,
          isUserDelegate: true,
        };
      } else {
        return {
          canTransfer: false,
          restrictionType: "non_transferable",
          message: `This token is non-transferable. Only the permanent delegate (${shortenAddress(inspection.permanentDelegate)}) can move it.`,
          delegateAddress: inspection.permanentDelegate,
          isUserDelegate: false,
        };
      }
    }
    
    return {
      canTransfer: false,
      restrictionType: "non_transferable",
      message: "This token is non-transferable (soulbound). It cannot be sent to anyone.",
    };
  }

  if (inspection.hasTransferHook) {
    return {
      canTransfer: true,
      restrictionType: "transfer_hook",
      message: "This token has transfer restrictions (Token-2022). Some transfers may fail.",
    };
  }

  if (inspection.hasPermanentDelegate && inspection.permanentDelegate) {
    return {
      canTransfer: true,
      restrictionType: "none",
      message: `Permanent delegate enabled: ${shortenAddress(inspection.permanentDelegate)}`,
      delegateAddress: inspection.permanentDelegate,
    };
  }

  return {
    canTransfer: true,
    restrictionType: "none",
    message: "",
  };
}

function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
