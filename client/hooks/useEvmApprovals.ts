import { useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "@react-navigation/native";
import {
  discoverAndRefreshApprovals,
  EnrichedApproval,
  computeRiskSummary,
  RiskLevel,
} from "@/lib/approvals/discovery";
import { listApprovals } from "@/lib/approvals/store";
import { enrichApproval } from "@/lib/approvals/discovery";

const SUPPORTED_CHAINS = [1, 137, 56];

export interface EvmApprovalsResult {
  approvals: EnrichedApproval[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  riskSummary: {
    overallRisk: RiskLevel;
    totalCount: number;
    unlimitedCount: number;
    highRiskCount: number;
    mediumRiskCount: number;
  };
}

export function useEvmApprovals(evmAddress: string | undefined): EvmApprovalsResult {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchApprovals = async (): Promise<EnrichedApproval[]> => {
    if (!evmAddress) return [];
    
    const owner = evmAddress as `0x${string}`;
    const allApprovals: EnrichedApproval[] = [];
    
    for (const chainId of SUPPORTED_CHAINS) {
      try {
        const chainApprovals = await discoverAndRefreshApprovals(owner, chainId);
        allApprovals.push(...chainApprovals);
      } catch (error) {
        console.error(`[useEvmApprovals] Error fetching chain ${chainId}:`, error);
      }
    }
    
    return allApprovals.sort((a, b) => {
      const riskOrder = { high: 0, medium: 1, low: 2 };
      const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      if (riskDiff !== 0) return riskDiff;
      return b.createdAt - a.createdAt;
    });
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["/evm-approvals", evmAddress],
    queryFn: fetchApprovals,
    enabled: !!evmAddress,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const refresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [refetch, isRefreshing]);

  useFocusEffect(
    useCallback(() => {
      if (evmAddress) {
        loadCachedApprovals();
      }
    }, [evmAddress])
  );

  const loadCachedApprovals = async () => {
    if (!evmAddress) return;
    
    const owner = evmAddress as `0x${string}`;
    const cached: EnrichedApproval[] = [];
    
    for (const chainId of SUPPORTED_CHAINS) {
      const chainApprovals = await listApprovals({ owner, chainId });
      const enriched = chainApprovals
        .filter(a => a.status !== "revoked" && a.allowanceRaw !== "0")
        .map(a => enrichApproval(a));
      cached.push(...enriched);
    }
    
    if (cached.length > 0 && !data?.length) {
      queryClient.setQueryData(["/evm-approvals", evmAddress], cached);
    }
  };

  const approvals = data || [];
  const riskSummary = computeRiskSummary(approvals);

  return {
    approvals,
    isLoading,
    isRefreshing,
    error: error as Error | null,
    refresh,
    riskSummary,
  };
}
