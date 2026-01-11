export type RiskLevel = "low" | "medium" | "high";

export interface MessageAnalysis {
  purposeLabel: string;
  riskLevel: RiskLevel;
  reason: string;
  warnings: string[];
  explainBullets: {
    why: string;
    capability: string;
    safetyTip: string;
  };
}

const SUSPICIOUS_KEYWORDS = [
  "seed",
  "private key",
  "recovery",
  "wallet phrase",
  "send funds",
  "approve",
  "transfer",
  "authorize spending",
  "mnemonic",
  "secret",
];

const SIWE_KEYWORDS = ["domain:", "nonce:", "issuedat", "issued at", "uri:", "statement:"];

function looksLikeChallenge(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.includes(" ") && trimmed.split(" ").length > 3) return false;
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/;
  const base64Regex = /^[A-Za-z0-9+/=]{32,256}$/;
  return base58Regex.test(trimmed) || base64Regex.test(trimmed);
}

function containsSIWE(message: string): boolean {
  const lower = message.toLowerCase();
  return SIWE_KEYWORDS.filter((kw) => lower.includes(kw)).length >= 2;
}

function extractUrls(message: string): string[] {
  const urlRegex = /https?:\/\/[^\s"'<>]+/gi;
  return message.match(urlRegex) || [];
}

function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function containsSuspiciousKeywords(message: string): string[] {
  const lower = message.toLowerCase();
  return SUSPICIOUS_KEYWORDS.filter((kw) => lower.includes(kw.toLowerCase()));
}

export function analyzeSignMessage({
  message,
  dappDomain,
  chain,
  isDomainVerified,
}: {
  message: string;
  dappDomain: string;
  chain: "solana" | "evm";
  isDomainVerified: boolean;
}): MessageAnalysis {
  const warnings: string[] = [];
  let riskLevel: RiskLevel = "low";
  let purposeLabel = "Message signature request";
  let reason = "Standard message signing request";

  const suspiciousKeywords = containsSuspiciousKeywords(message);
  if (suspiciousKeywords.length > 0) {
    riskLevel = "high";
    warnings.push(
      `Message contains suspicious keywords: ${suspiciousKeywords.slice(0, 3).join(", ")}`
    );
    reason = "Message contains potentially dangerous keywords";
  }

  if (!isDomainVerified) {
    warnings.push("This dApp did not provide a verifiable domain");
    if (riskLevel === "low") riskLevel = "medium";
  }

  const urls = extractUrls(message);
  const mismatchedUrls = urls.filter((url) => {
    const urlDomain = getDomainFromUrl(url);
    return urlDomain && urlDomain !== dappDomain && !urlDomain.endsWith(`.${dappDomain}`);
  });
  if (mismatchedUrls.length > 0) {
    warnings.push(`Message contains URLs from different domains`);
    if (riskLevel === "low") riskLevel = "medium";
  }

  if (containsSIWE(message)) {
    purposeLabel = "Sign-in verification (SIWE)";
    reason = "This is a standard Sign-In with Ethereum request used for authentication";
    if (riskLevel === "low" && warnings.length === 0) {
      riskLevel = "low";
    }
  } else if (looksLikeChallenge(message)) {
    purposeLabel = "Login / Wallet verification";
    reason = "This appears to be a login challenge or nonce for authentication";
    if (riskLevel === "low" && warnings.length === 0) {
      riskLevel = "low";
    }
  } else if (message.length > 1000) {
    if (riskLevel === "low") riskLevel = "medium";
    reason = "Unusually long message - review carefully before signing";
  }

  const chainName = chain === "solana" ? "Solana" : "Ethereum";
  const dappName = dappDomain || "this dApp";

  const explainBullets = {
    why:
      purposeLabel === "Sign-in verification (SIWE)"
        ? `${dappName} wants to verify you own this wallet for login purposes.`
        : purposeLabel === "Login / Wallet verification"
          ? `${dappName} is requesting proof that you control this wallet address.`
          : `${dappName} is requesting your cryptographic signature on this message.`,
    capability:
      "Signing this message cannot move your funds, cannot approve token spending, and cannot execute any blockchain transactions.",
    safetyTip:
      riskLevel === "high"
        ? `Warning: Review this message carefully. Only sign if you fully trust ${dappName}.`
        : `Only sign messages from dApps you trust. ${dappName} will be able to verify your wallet ownership.`,
  };

  return {
    purposeLabel,
    riskLevel,
    reason,
    warnings,
    explainBullets,
  };
}
