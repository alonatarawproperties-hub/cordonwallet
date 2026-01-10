import { formatUnits } from "viem";
import { DetectedApproval, ApprovalPolicyResult, MAX_UINT256 } from "./types";
import { PolicySettings } from "../types";
import { isTrustedSpender } from "./spenders";

export interface FirewallCheckParams {
  chainId: number;
  approval: DetectedApproval;
  policySettings: PolicySettings;
  tokenDecimals?: number;
  tokenSymbol?: string;
}

export function checkApprovalPolicy(params: FirewallCheckParams): ApprovalPolicyResult {
  const { chainId, approval, policySettings, tokenDecimals = 18, tokenSymbol = "tokens" } = params;

  if (policySettings.denylistedAddresses.some(
    addr => addr.toLowerCase() === approval.spender.toLowerCase()
  )) {
    return {
      allowed: false,
      reason: `Spender address is on your denylist. This transaction is blocked for your safety.`,
    };
  }

  if (policySettings.allowlistedAddresses.some(
    addr => addr.toLowerCase() === approval.spender.toLowerCase()
  )) {
    return { allowed: true };
  }

  if (approval.isUnlimited && policySettings.blockUnlimitedApprovals) {
    const suggestedCap = calculateSuggestedCap(policySettings, tokenDecimals);
    const suggestedCapFormatted = formatUnits(suggestedCap, tokenDecimals);

    return {
      allowed: false,
      reason: `Unlimited approvals can allow token drains. Use a capped allowance instead.`,
      suggestedCap,
      suggestedCapFormatted: `${suggestedCapFormatted} ${tokenSymbol}`,
    };
  }

  return { allowed: true };
}

function calculateSuggestedCap(policySettings: PolicySettings, tokenDecimals: number): bigint {
  const maxSpendUsd = parseFloat(policySettings.maxSpendPerTransaction) || 1000;
  const estimatedTokensForMaxSpend = maxSpendUsd * 10;
  
  return BigInt(Math.floor(estimatedTokensForMaxSpend)) * (10n ** BigInt(tokenDecimals));
}

export function createCappedApproval(
  originalApproval: DetectedApproval,
  capAmount: bigint
): DetectedApproval {
  return {
    ...originalApproval,
    amountRaw: capAmount,
    isUnlimited: false,
  };
}

export function encodeApproveCalldata(
  spender: `0x${string}`,
  amount: bigint
): `0x${string}` {
  const amountHex = amount.toString(16).padStart(64, "0");
  const spenderPadded = spender.slice(2).toLowerCase().padStart(64, "0");
  
  return `0x095ea7b3${spenderPadded}${amountHex}` as `0x${string}`;
}

export interface TransactionFirewallResult {
  allowed: boolean;
  isApproval: boolean;
  approval?: DetectedApproval;
  policyResult?: ApprovalPolicyResult;
  modifiedCalldata?: `0x${string}`;
}

export function checkTransactionFirewall(params: {
  chainId: number;
  to: `0x${string}`;
  data?: `0x${string}`;
  policySettings: PolicySettings;
  tokenDecimals?: number;
  tokenSymbol?: string;
}): TransactionFirewallResult {
  const { chainId, to, data, policySettings, tokenDecimals, tokenSymbol } = params;

  if (!data || data === "0x" || data.length < 10) {
    return { allowed: true, isApproval: false };
  }

  const selector = data.slice(0, 10).toLowerCase();
  
  if (selector !== "0x095ea7b3") {
    return { allowed: true, isApproval: false };
  }

  const { detectApproveIntent } = require("./detect");
  const approval = detectApproveIntent(to, data);

  if (!approval) {
    return { allowed: true, isApproval: false };
  }

  const policyResult = checkApprovalPolicy({
    chainId,
    approval,
    policySettings,
    tokenDecimals,
    tokenSymbol,
  });

  return {
    allowed: policyResult.allowed,
    isApproval: true,
    approval,
    policyResult,
  };
}

export function formatAllowance(
  amount: bigint,
  decimals: number,
  symbol: string
): string {
  if (amount >= MAX_UINT256 / 2n) {
    return "Unlimited";
  }
  
  const formatted = formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)}M ${symbol}`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(2)}K ${symbol}`;
  }
  if (num >= 1) {
    return `${num.toFixed(2)} ${symbol}`;
  }
  return `${num.toFixed(6)} ${symbol}`;
}
