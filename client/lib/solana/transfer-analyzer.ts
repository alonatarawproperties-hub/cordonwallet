import { Connection, PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionTypes,
  ExtensionType,
  getMint,
} from "@solana/spl-token";

export interface TransferAnalysisFlags {
  isNonTransferable?: boolean;
  hasTransferHook?: boolean;
  hasPermanentDelegate?: boolean;
  hasFreezeAuthority?: boolean;
  hasTransferFee?: boolean;
  hasConfidentialTransfers?: boolean;
}

export interface TransferWarning {
  code: string;
  title: string;
  message: string;
}

export type TransferRiskLevel = "low" | "medium" | "high" | "blocked" | "unknown";

export interface TransferAnalysisResult {
  riskLevel: TransferRiskLevel;
  warnings: TransferWarning[];
  tokenStandard: "spl-token" | "token-2022" | "unknown";
  flags: TransferAnalysisFlags;
  canTransfer: boolean;
  permanentDelegate?: string;
  isUserDelegate?: boolean;
}

interface AnalyzeParams {
  connection: Connection;
  mintAddress: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
}

const ANALYSIS_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
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

async function analyzeInternal(params: AnalyzeParams): Promise<TransferAnalysisResult> {
  const { connection, mintAddress, fromAddress } = params;
  
  const unknownResult: TransferAnalysisResult = {
    riskLevel: "unknown",
    warnings: [{
      code: "ANALYSIS_FAILED",
      title: "Analysis Unavailable",
      message: "Couldn't analyze token restrictions. Proceed with caution.",
    }],
    tokenStandard: "unknown",
    flags: {},
    canTransfer: true,
  };

  try {
    const mintPk = new PublicKey(mintAddress);
    const accountInfo = await connection.getAccountInfo(mintPk, "confirmed");

    if (!accountInfo) {
      return {
        ...unknownResult,
        warnings: [{
          code: "MINT_NOT_FOUND",
          title: "Token Not Found",
          message: "Could not find token mint account on-chain.",
        }],
      };
    }

    const isToken2022 = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
    const isSplToken = accountInfo.owner.equals(TOKEN_PROGRAM_ID);

    if (!isToken2022 && !isSplToken) {
      return unknownResult;
    }

    if (!isToken2022) {
      try {
        const mintInfo = await getMint(connection, mintPk, "confirmed", TOKEN_PROGRAM_ID);
        const hasFreezeAuth = !!mintInfo.freezeAuthority;
        
        return {
          riskLevel: hasFreezeAuth ? "low" : "low",
          warnings: hasFreezeAuth ? [{
            code: "FREEZE_AUTHORITY",
            title: "Freeze Authority Active",
            message: "This token has an active freeze authority. The issuer can freeze transfers.",
          }] : [],
          tokenStandard: "spl-token",
          flags: {
            hasFreezeAuthority: hasFreezeAuth,
          },
          canTransfer: true,
        };
      } catch {
        return {
          riskLevel: "low",
          warnings: [],
          tokenStandard: "spl-token",
          flags: {},
          canTransfer: true,
        };
      }
    }

    const mintInfo = await getMint(connection, mintPk, "confirmed", TOKEN_2022_PROGRAM_ID);
    const extensions = getExtensionTypes(accountInfo.data);

    const flags: TransferAnalysisFlags = {
      isNonTransferable: extensions.includes(ExtensionType.NonTransferable),
      hasPermanentDelegate: extensions.includes(ExtensionType.PermanentDelegate),
      hasTransferHook: extensions.includes(ExtensionType.TransferHook),
      hasTransferFee: extensions.includes(ExtensionType.TransferFeeConfig),
      hasFreezeAuthority: !!mintInfo.freezeAuthority,
      hasConfidentialTransfers: extensions.includes(ExtensionType.ConfidentialTransferMint),
    };

    let permanentDelegate: string | undefined;
    if (flags.hasPermanentDelegate) {
      permanentDelegate = parsePermanentDelegateFromBuffer(accountInfo.data) || undefined;
    }

    const isUserDelegate = permanentDelegate
      ? permanentDelegate.toLowerCase() === fromAddress.toLowerCase()
      : false;

    const warnings: TransferWarning[] = [];
    let riskLevel: TransferRiskLevel = "low";
    let canTransfer = true;

    if (flags.isNonTransferable) {
      if (permanentDelegate && isUserDelegate) {
        warnings.push({
          code: "NON_TRANSFERABLE_DELEGATE",
          title: "Non-Transferable Token (You Are Delegate)",
          message: "This token is non-transferable, but you are the permanent delegate and can transfer it.",
        });
        riskLevel = "medium";
        canTransfer = true;
      } else if (permanentDelegate) {
        warnings.push({
          code: "NON_TRANSFERABLE_BLOCKED",
          title: "Cannot Send - Non-Transferable Token",
          message: `This token is non-transferable. Only the permanent delegate (${shortenAddress(permanentDelegate)}) can move it.`,
        });
        riskLevel = "blocked";
        canTransfer = false;
      } else {
        warnings.push({
          code: "NON_TRANSFERABLE_SOULBOUND",
          title: "Cannot Send - Soulbound Token",
          message: "This token is non-transferable (soulbound). It cannot be sent to anyone.",
        });
        riskLevel = "blocked";
        canTransfer = false;
      }
    }

    if (flags.hasTransferHook && riskLevel !== "blocked") {
      warnings.push({
        code: "TRANSFER_HOOK",
        title: "Transfer Hook Active",
        message: "This token has a transfer hook. A custom program controls transfers. Some transfers may be rejected.",
      });
      if (riskLevel === "low") riskLevel = "high";
    }

    if (flags.hasPermanentDelegate && !flags.isNonTransferable && permanentDelegate) {
      warnings.push({
        code: "PERMANENT_DELEGATE",
        title: "Permanent Delegate",
        message: `This token has a permanent delegate (${shortenAddress(permanentDelegate)}) who can transfer tokens without your approval.`,
      });
      if (riskLevel === "low") riskLevel = "medium";
    }

    if (flags.hasTransferFee && riskLevel !== "blocked") {
      warnings.push({
        code: "TRANSFER_FEE",
        title: "Transfer Fee Active",
        message: "This token charges a fee on transfers. You may receive less than expected.",
      });
      if (riskLevel === "low") riskLevel = "medium";
    }

    if (flags.hasConfidentialTransfers) {
      warnings.push({
        code: "CONFIDENTIAL_TRANSFERS",
        title: "Confidential Transfers Enabled",
        message: "This token supports confidential transfers with encrypted amounts.",
      });
    }

    if (flags.hasFreezeAuthority && !flags.isNonTransferable) {
      warnings.push({
        code: "FREEZE_AUTHORITY",
        title: "Freeze Authority Active",
        message: "This token can be frozen by the issuer.",
      });
    }

    return {
      riskLevel,
      warnings,
      tokenStandard: "token-2022",
      flags,
      canTransfer,
      permanentDelegate,
      isUserDelegate,
    };
  } catch (error) {
    console.error("[TransferAnalyzer] Analysis failed:", error);
    return unknownResult;
  }
}

export async function analyzeSolanaTransfer(params: AnalyzeParams): Promise<TransferAnalysisResult> {
  const fallbackResult: TransferAnalysisResult = {
    riskLevel: "unknown",
    warnings: [{
      code: "ANALYSIS_TIMEOUT",
      title: "Analysis Timed Out",
      message: "Token analysis took too long. Proceed with caution.",
    }],
    tokenStandard: "unknown",
    flags: {},
    canTransfer: true,
  };

  try {
    return await withTimeout(analyzeInternal(params), ANALYSIS_TIMEOUT_MS, fallbackResult);
  } catch (error) {
    console.error("[TransferAnalyzer] Unexpected error:", error);
    return fallbackResult;
  }
}

export function buildWarningBanners(result: TransferAnalysisResult): Array<{
  type: "danger" | "warning" | "info";
  title: string;
  message: string;
  icon: string;
}> {
  return result.warnings.map((warning) => {
    let type: "danger" | "warning" | "info" = "info";
    let icon = "info";

    if (warning.code.includes("BLOCKED") || warning.code.includes("SOULBOUND")) {
      type = "danger";
      icon = "x-octagon";
    } else if (
      warning.code.includes("NON_TRANSFERABLE") ||
      warning.code.includes("TRANSFER_HOOK") ||
      warning.code.includes("PERMANENT_DELEGATE")
    ) {
      type = "warning";
      icon = "alert-triangle";
    } else if (warning.code.includes("TRANSFER_FEE")) {
      type = "warning";
      icon = "percent";
    } else if (warning.code.includes("FREEZE")) {
      type = "info";
      icon = "lock";
    } else if (warning.code.includes("CONFIDENTIAL")) {
      type = "info";
      icon = "eye-off";
    } else if (warning.code.includes("TIMEOUT") || warning.code.includes("FAILED")) {
      type = "warning";
      icon = "alert-circle";
    }

    return {
      type,
      title: warning.title,
      message: warning.message,
      icon,
    };
  });
}
