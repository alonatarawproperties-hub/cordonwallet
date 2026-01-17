import { Connection, PublicKey } from "@solana/web3.js";
import { 
  getExtensionTypes, 
  ExtensionType,
  getMint,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

export type RiskLevel = "safe" | "caution" | "risky";

export interface SecurityCheck {
  name: string;
  detected: boolean;
  riskLevel: RiskLevel;
  explanation: string;
  technicalDetail: string;
}

export interface TokenSecurityAssessment {
  mintAddress: string;
  isToken2022: boolean;
  overallRisk: RiskLevel;
  riskScore: number;
  checks: SecurityCheck[];
  summary: string;
}

const EXTENSION_SECURITY_INFO: Record<number, { 
  name: string; 
  riskLevel: RiskLevel; 
  explanation: string; 
  technicalDetail: string 
}> = {
  [ExtensionType.TransferFeeConfig]: {
    name: "Transfer Fees",
    riskLevel: "caution",
    explanation: "This token charges a fee every time you send it. A portion goes to the token creator.",
    technicalDetail: "TransferFeeConfig extension enables automatic fee deduction on transfers.",
  },
  [ExtensionType.TransferFeeAmount]: {
    name: "Transfer Fee Amount",
    riskLevel: "caution",
    explanation: "Transfer fees are configured for this token.",
    technicalDetail: "TransferFeeAmount tracks pending fees on token accounts.",
  },
  [ExtensionType.MintCloseAuthority]: {
    name: "Mint Close Authority",
    riskLevel: "caution",
    explanation: "The token creator can close the mint, but your tokens remain safe.",
    technicalDetail: "MintCloseAuthority allows closing the mint account when supply is zero.",
  },
  [ExtensionType.ConfidentialTransferMint]: {
    name: "Confidential Transfers",
    riskLevel: "caution",
    explanation: "Transfer amounts can be hidden. While this adds privacy, it could obscure suspicious activity.",
    technicalDetail: "ConfidentialTransferMint enables encrypted transfer amounts using zero-knowledge proofs.",
  },
  [ExtensionType.ConfidentialTransferAccount]: {
    name: "Confidential Account",
    riskLevel: "caution",
    explanation: "This account supports hidden transfer amounts.",
    technicalDetail: "ConfidentialTransferAccount stores encrypted balance state.",
  },
  [ExtensionType.DefaultAccountState]: {
    name: "Default Frozen",
    riskLevel: "risky",
    explanation: "New token accounts are frozen by default. You may need approval to move your tokens.",
    technicalDetail: "DefaultAccountState can set new accounts to frozen, requiring authority to unfreeze.",
  },
  [ExtensionType.ImmutableOwner]: {
    name: "Immutable Owner",
    riskLevel: "safe",
    explanation: "Your ownership of these tokens cannot be changed. This is a security feature.",
    technicalDetail: "ImmutableOwner prevents the token account owner from being reassigned.",
  },
  [ExtensionType.MemoTransfer]: {
    name: "Memo Required",
    riskLevel: "safe",
    explanation: "Transfers require a memo message. This is common for compliance.",
    technicalDetail: "MemoTransfer requires incoming transfers to include a memo instruction.",
  },
  [ExtensionType.NonTransferable]: {
    name: "Non-Transferable (Soulbound)",
    riskLevel: "caution",
    explanation: "This token cannot be sent to others. It's permanently bound to your wallet.",
    technicalDetail: "NonTransferable makes the token soulbound - it cannot be transferred after minting.",
  },
  [ExtensionType.InterestBearingConfig]: {
    name: "Interest Bearing",
    riskLevel: "caution",
    explanation: "Your balance may change over time due to built-in interest. Check the rate carefully.",
    technicalDetail: "InterestBearingConfig allows the displayed balance to accrue interest automatically.",
  },
  [ExtensionType.CpiGuard]: {
    name: "CPI Guard",
    riskLevel: "safe",
    explanation: "Extra protection against malicious programs. This is a security feature.",
    technicalDetail: "CpiGuard prevents certain cross-program invocation attacks on the token account.",
  },
  [ExtensionType.PermanentDelegate]: {
    name: "Permanent Delegate",
    riskLevel: "risky",
    explanation: "Someone else has permanent control over your tokens. They can transfer or burn them anytime without your permission.",
    technicalDetail: "PermanentDelegate grants an address irrevocable authority to transfer/burn tokens from any holder.",
  },
  [ExtensionType.TransferHook]: {
    name: "Transfer Hook",
    riskLevel: "caution",
    explanation: "Custom code runs on every transfer. This could add restrictions or fees.",
    technicalDetail: "TransferHook executes a custom program on every transfer, enabling complex logic.",
  },
  [ExtensionType.TransferHookAccount]: {
    name: "Transfer Hook Account",
    riskLevel: "caution",
    explanation: "This account has custom transfer rules.",
    technicalDetail: "TransferHookAccount stores state for transfer hook program.",
  },
  [ExtensionType.MetadataPointer]: {
    name: "Metadata Pointer",
    riskLevel: "safe",
    explanation: "Token metadata is stored on-chain. Normal for modern tokens.",
    technicalDetail: "MetadataPointer points to on-chain metadata location.",
  },
  [ExtensionType.TokenMetadata]: {
    name: "Token Metadata",
    riskLevel: "safe",
    explanation: "Token name, symbol, and image are stored on-chain.",
    technicalDetail: "TokenMetadata stores name, symbol, URI directly in the mint account.",
  },
  [ExtensionType.GroupPointer]: {
    name: "Group Pointer",
    riskLevel: "safe",
    explanation: "This token belongs to a collection or group.",
    technicalDetail: "GroupPointer links the token to a group/collection account.",
  },
  [ExtensionType.GroupMemberPointer]: {
    name: "Group Member",
    riskLevel: "safe",
    explanation: "This token is part of a group or collection.",
    technicalDetail: "GroupMemberPointer indicates membership in a token group.",
  },
};

const FREEZE_AUTHORITY_CHECK: SecurityCheck = {
  name: "Freeze Authority",
  detected: true,
  riskLevel: "risky",
  explanation: "The token creator can freeze your tokens, preventing you from moving or selling them.",
  technicalDetail: "Freeze authority is set on the mint, allowing the authority to freeze any token account.",
};

const NO_FREEZE_AUTHORITY_CHECK: SecurityCheck = {
  name: "Freeze Authority",
  detected: false,
  riskLevel: "safe",
  explanation: "No one can freeze your tokens. You have full control.",
  technicalDetail: "Freeze authority is null/revoked on this mint.",
};

export async function analyzeTokenSecurity(
  connection: Connection,
  mintAddress: string
): Promise<TokenSecurityAssessment> {
  const checks: SecurityCheck[] = [];
  let isToken2022 = false;

  try {
    const mintPubkey = new PublicKey(mintAddress);
    
    let mintInfo;
    try {
      mintInfo = await getMint(connection, mintPubkey, "confirmed", TOKEN_2022_PROGRAM_ID);
      isToken2022 = true;
    } catch {
      try {
        const { getMint: getLegacyMint, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
        mintInfo = await getLegacyMint(connection, mintPubkey, "confirmed", TOKEN_PROGRAM_ID);
        isToken2022 = false;
      } catch {
        return {
          mintAddress,
          isToken2022: false,
          overallRisk: "safe",
          riskScore: 0,
          checks: [],
          summary: "Unable to analyze this token. It may be a legacy SPL token.",
        };
      }
    }

    if (mintInfo.freezeAuthority) {
      checks.push(FREEZE_AUTHORITY_CHECK);
    } else {
      checks.push(NO_FREEZE_AUTHORITY_CHECK);
    }

    if (isToken2022) {
      try {
        const accountInfo = await connection.getAccountInfo(mintPubkey);
        if (accountInfo) {
          const extensions = getExtensionTypes(accountInfo.data);
          
          for (const ext of extensions) {
            const info = EXTENSION_SECURITY_INFO[ext];
            if (info) {
              checks.push({
                name: info.name,
                detected: true,
                riskLevel: info.riskLevel,
                explanation: info.explanation,
                technicalDetail: info.technicalDetail,
              });
            }
          }
        }
      } catch (e) {
        console.warn("Failed to get extension types:", e);
      }
    }

    const riskyCount = checks.filter(c => c.detected && c.riskLevel === "risky").length;
    const cautionCount = checks.filter(c => c.detected && c.riskLevel === "caution").length;
    
    let overallRisk: RiskLevel = "safe";
    let riskScore = 0;
    
    if (riskyCount > 0) {
      overallRisk = "risky";
      riskScore = 70 + (riskyCount * 10) + (cautionCount * 5);
    } else if (cautionCount > 0) {
      overallRisk = "caution";
      riskScore = 30 + (cautionCount * 10);
    } else {
      riskScore = 0;
    }
    
    riskScore = Math.min(riskScore, 100);

    let summary = "";
    if (overallRisk === "risky") {
      const riskyItems = checks.filter(c => c.detected && c.riskLevel === "risky").map(c => c.name);
      summary = `High risk token. ${riskyItems.join(", ")} detected. Exercise extreme caution.`;
    } else if (overallRisk === "caution") {
      const cautionItems = checks.filter(c => c.detected && c.riskLevel === "caution").map(c => c.name);
      summary = `Some concerns: ${cautionItems.join(", ")}. Review before transacting.`;
    } else {
      summary = isToken2022 
        ? "This Token-2022 token appears safe with no risky extensions."
        : "Standard SPL token with no unusual permissions.";
    }

    return {
      mintAddress,
      isToken2022,
      overallRisk,
      riskScore,
      checks,
      summary,
    };
  } catch (error) {
    console.error("Token security analysis failed:", error);
    return {
      mintAddress,
      isToken2022: false,
      overallRisk: "caution",
      riskScore: 50,
      checks: [],
      summary: "Unable to fully analyze this token. Proceed with caution.",
    };
  }
}

export function getRiskColor(risk: RiskLevel): string {
  switch (risk) {
    case "safe": return "#22C55E";
    case "caution": return "#F59E0B";
    case "risky": return "#EF4444";
  }
}

export function getRiskIcon(risk: RiskLevel): string {
  switch (risk) {
    case "safe": return "check-circle";
    case "caution": return "alert-triangle";
    case "risky": return "alert-octagon";
  }
}
