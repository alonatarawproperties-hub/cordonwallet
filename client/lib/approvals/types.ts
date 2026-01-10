export const MAX_UINT256 = 2n ** 256n - 1n;

export type ApprovalStatus = "pending" | "confirmed" | "failed" | "revoking" | "revoked";

export interface ApprovalRecord {
  id: string;
  chainId: number;
  owner: `0x${string}`;
  tokenAddress: `0x${string}`;
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimals?: number;
  spender: `0x${string}`;
  spenderLabel?: string;
  allowanceRaw: string;
  allowanceFormatted?: string;
  isUnlimited: boolean;
  createdAt: number;
  txHash: `0x${string}`;
  status: ApprovalStatus;
  lastCheckedAt?: number;
  revokeHash?: `0x${string}`;
}

export interface DetectedApproval {
  tokenAddress: `0x${string}`;
  spender: `0x${string}`;
  amountRaw: bigint;
  isUnlimited: boolean;
}

export interface ApprovalPolicyResult {
  allowed: boolean;
  reason?: string;
  suggestedCap?: bigint;
  suggestedCapFormatted?: string;
}

export function generateApprovalId(
  owner: `0x${string}`,
  chainId: number,
  tokenAddress: `0x${string}`,
  spender: `0x${string}`
): string {
  return `${owner.toLowerCase()}-${chainId}-${tokenAddress.toLowerCase()}-${spender.toLowerCase()}`;
}

export function isUnlimitedAllowance(amount: bigint): boolean {
  return amount >= MAX_UINT256 / 2n;
}
