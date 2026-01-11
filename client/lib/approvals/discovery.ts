import { createPublicClient, http, formatUnits, erc20Abi } from "viem";
import { mainnet, polygon, bsc } from "viem/chains";
import { getChainById } from "@/lib/blockchain/chains";
import { defaultTokens } from "@/lib/blockchain/tokens";
import { getSpenderLabel, isKnownSpender, isTrustedSpender } from "./spenders";
import { ApprovalRecord, generateApprovalId, isUnlimitedAllowance } from "./types";
import { listApprovals, upsertApproval } from "./store";
import { getApiUrl } from "@/lib/query-client";

export type RiskLevel = "high" | "medium" | "low";

export interface EnrichedApproval extends ApprovalRecord {
  riskLevel: RiskLevel;
  riskReason: string;
  isHighValueToken: boolean;
}

const HIGH_VALUE_TOKENS = new Set([
  "USDC", "USDT", "DAI", "WETH", "WBTC", "WBNB", "WMATIC", "BUSD"
]);

const viemChains = {
  1: mainnet,
  137: polygon,
  56: bsc,
};

function getViemChain(chainId: number) {
  return viemChains[chainId as keyof typeof viemChains];
}

export function evaluateApprovalRisk(approval: ApprovalRecord): { level: RiskLevel; reason: string } {
  const isUnlimited = approval.isUnlimited;
  const isHighValue = HIGH_VALUE_TOKENS.has(approval.tokenSymbol?.toUpperCase() || "");
  const isKnown = isKnownSpender(approval.chainId, approval.spender);
  const isTrusted = isTrustedSpender(approval.chainId, approval.spender);
  const daysSinceCreated = (Date.now() - approval.createdAt) / (1000 * 60 * 60 * 24);
  const isStale = daysSinceCreated > 90;

  if (isUnlimited && (isHighValue || !isKnown)) {
    return {
      level: "high",
      reason: isHighValue 
        ? `Unlimited access to ${approval.tokenSymbol}`
        : "Unlimited access to unknown spender",
    };
  }

  if (isUnlimited && isStale) {
    return {
      level: "medium",
      reason: `Unlimited approval inactive for ${Math.floor(daysSinceCreated)} days`,
    };
  }

  if (isUnlimited && !isTrusted) {
    return {
      level: "medium",
      reason: "Unlimited approval to unverified protocol",
    };
  }

  if (!isKnown) {
    return {
      level: "medium",
      reason: "Unknown spender address",
    };
  }

  return {
    level: "low",
    reason: isTrusted ? "Trusted protocol with capped allowance" : "Capped allowance",
  };
}

export function enrichApproval(approval: ApprovalRecord): EnrichedApproval {
  const risk = evaluateApprovalRisk(approval);
  return {
    ...approval,
    riskLevel: risk.level,
    riskReason: risk.reason,
    isHighValueToken: HIGH_VALUE_TOKENS.has(approval.tokenSymbol?.toUpperCase() || ""),
  };
}

export async function queryOnChainAllowance(
  chainId: number,
  owner: `0x${string}`,
  tokenAddress: `0x${string}`,
  spender: `0x${string}`
): Promise<bigint> {
  const chainConfig = getChainById(chainId);
  const viemChain = getViemChain(chainId);
  
  if (!chainConfig || !viemChain) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const client = createPublicClient({
    chain: viemChain,
    transport: http(chainConfig.rpcUrl),
  });

  try {
    const allowance = await client.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, spender],
    });
    return allowance;
  } catch (error) {
    console.error(`[Discovery] Failed to query allowance for ${tokenAddress}:`, error);
    return 0n;
  }
}

export async function queryTokenInfo(
  chainId: number,
  tokenAddress: `0x${string}`
): Promise<{ symbol: string; name: string; decimals: number } | null> {
  const chainConfig = getChainById(chainId);
  const viemChain = getViemChain(chainId);
  
  if (!chainConfig || !viemChain) return null;

  const client = createPublicClient({
    chain: viemChain,
    transport: http(chainConfig.rpcUrl),
  });

  try {
    const [symbol, name, decimals] = await Promise.all([
      client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "name" }),
      client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return { symbol: symbol as string, name: name as string, decimals: decimals as number };
  } catch (error) {
    console.error(`[Discovery] Failed to query token info for ${tokenAddress}:`, error);
    return null;
  }
}

interface ExplorerApproval {
  tokenAddress: string;
  spender: string;
  txHash: string;
  timestamp: number;
}

export async function fetchApprovalsFromExplorer(
  owner: string,
  chainId: number
): Promise<ExplorerApproval[]> {
  try {
    const apiUrl = getApiUrl();
    const url = new URL(`/api/approvals/${owner}`, apiUrl);
    url.searchParams.set("chainId", chainId.toString());
    
    const response = await fetch(url.toString());
    if (!response.ok) {
      console.log(`[Discovery] Explorer API returned ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    return data.approvals || [];
  } catch (error) {
    console.error(`[Discovery] Failed to fetch approvals from explorer:`, error);
    return [];
  }
}

export async function discoverAndRefreshApprovals(
  owner: `0x${string}`,
  chainId: number
): Promise<EnrichedApproval[]> {
  const existingApprovals = await listApprovals({ owner, chainId });
  const existingMap = new Map(existingApprovals.map(a => [a.id, a]));
  
  const explorerApprovals = await fetchApprovalsFromExplorer(owner, chainId);
  
  for (const ea of explorerApprovals) {
    const id = generateApprovalId(
      owner,
      chainId,
      ea.tokenAddress as `0x${string}`,
      ea.spender as `0x${string}`
    );
    
    if (!existingMap.has(id)) {
      existingMap.set(id, {
        id,
        chainId,
        owner,
        tokenAddress: ea.tokenAddress as `0x${string}`,
        spender: ea.spender as `0x${string}`,
        spenderLabel: getSpenderLabel(chainId, ea.spender as `0x${string}`),
        allowanceRaw: "0",
        isUnlimited: false,
        createdAt: ea.timestamp,
        txHash: ea.txHash as `0x${string}`,
        status: "confirmed",
      });
    }
  }
  
  const approvalEntries = Array.from(existingMap.values());
  const refreshedApprovals: EnrichedApproval[] = [];
  
  for (const approval of approvalEntries) {
    if (approval.status === "revoked" as const) continue;
    
    try {
      const allowance = await queryOnChainAllowance(
        chainId,
        owner,
        approval.tokenAddress,
        approval.spender
      );
      
      if (allowance === 0n) {
        await upsertApproval({ ...approval, status: "revoked" as const, allowanceRaw: "0", isUnlimited: false });
        continue;
      }
      
      let tokenInfo = approval.tokenSymbol ? null : await queryTokenInfo(chainId, approval.tokenAddress);
      
      const updatedApproval: ApprovalRecord = {
        ...approval,
        allowanceRaw: allowance.toString(),
        isUnlimited: isUnlimitedAllowance(allowance),
        tokenSymbol: approval.tokenSymbol || tokenInfo?.symbol,
        tokenName: approval.tokenName || tokenInfo?.name,
        tokenDecimals: approval.tokenDecimals || tokenInfo?.decimals,
        allowanceFormatted: tokenInfo?.decimals || approval.tokenDecimals
          ? formatUnits(allowance, tokenInfo?.decimals || approval.tokenDecimals || 18)
          : undefined,
        lastCheckedAt: Date.now(),
        status: "confirmed",
        spenderLabel: approval.spenderLabel || getSpenderLabel(chainId, approval.spender),
      };
      
      await upsertApproval(updatedApproval);
      refreshedApprovals.push(enrichApproval(updatedApproval));
    } catch (error) {
      console.error(`[Discovery] Error refreshing approval ${approval.id}:`, error);
      if (approval.allowanceRaw && approval.allowanceRaw !== "0") {
        refreshedApprovals.push(enrichApproval(approval));
      }
    }
  }
  
  return refreshedApprovals.sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 };
    return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
  });
}

export function computeRiskSummary(approvals: EnrichedApproval[]): {
  overallRisk: RiskLevel;
  totalCount: number;
  unlimitedCount: number;
  highRiskCount: number;
  mediumRiskCount: number;
} {
  const highRiskCount = approvals.filter(a => a.riskLevel === "high").length;
  const mediumRiskCount = approvals.filter(a => a.riskLevel === "medium").length;
  const unlimitedCount = approvals.filter(a => a.isUnlimited).length;
  
  let overallRisk: RiskLevel = "low";
  if (highRiskCount > 0) overallRisk = "high";
  else if (mediumRiskCount > 0) overallRisk = "medium";
  
  return {
    overallRisk,
    totalCount: approvals.length,
    unlimitedCount,
    highRiskCount,
    mediumRiskCount,
  };
}
