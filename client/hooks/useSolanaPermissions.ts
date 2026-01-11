import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "@react-navigation/native";
import { useWalletConnect } from "@/lib/walletconnect/context";
import {
  fetchSolanaDelegates,
  TokenDelegate,
  computeSolanaPermissionsSummary,
} from "@/lib/solana/permissions";
import type { WCSession } from "@/lib/walletconnect/client";

export interface SolanaSession extends WCSession {
  isSolana: boolean;
  isVerified: boolean;
  lastUsed?: number;
}

export interface SolanaPermissionsResult {
  sessions: SolanaSession[];
  delegates: TokenDelegate[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  disconnectSession: (topic: string) => Promise<void>;
  revokeDelegate: (tokenAccountAddress: string) => Promise<{ success: boolean; error?: string }>;
  summary: {
    connectedDApps: number;
    tokenDelegates: number;
    hasRiskyDelegates: boolean;
  };
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return url;
  }
}

function isVerifiedDomain(url: string): boolean {
  const verifiedDomains = [
    "uniswap.org",
    "app.uniswap.org",
    "raydium.io",
    "jup.ag",
    "jupiter.exchange",
    "marinade.finance",
    "phantom.app",
    "solflare.com",
    "orca.so",
    "tulip.garden",
    "tensor.trade",
    "magiceden.io",
  ];
  
  const domain = extractDomain(url);
  return verifiedDomains.some(d => domain.endsWith(d));
}

export function useSolanaPermissions(
  solanaAddress: string | undefined,
  walletId: string | undefined
): SolanaPermissionsResult {
  const { sessions: wcSessions, disconnect, refreshSessions } = useWalletConnect();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const solanaSessions: SolanaSession[] = useMemo(() => {
    return wcSessions
      .filter(session => 
        session.chains.some(chain => chain.startsWith("solana:"))
      )
      .map(session => ({
        ...session,
        isSolana: true,
        isVerified: isVerifiedDomain(session.peerMeta.url),
      }));
  }, [wcSessions]);

  const fetchDelegates = async (): Promise<TokenDelegate[]> => {
    if (!solanaAddress) return [];
    return fetchSolanaDelegates(solanaAddress);
  };

  const { data: delegates, isLoading, error, refetch } = useQuery({
    queryKey: ["/solana-delegates", solanaAddress],
    queryFn: fetchDelegates,
    enabled: !!solanaAddress,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const refresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      refreshSessions();
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [refetch, refreshSessions, isRefreshing]);

  useFocusEffect(
    useCallback(() => {
      refreshSessions();
    }, [refreshSessions])
  );

  const disconnectSession = useCallback(async (topic: string) => {
    await disconnect(topic);
  }, [disconnect]);

  const revokeDelegate = useCallback(async (tokenAccountAddress: string) => {
    if (!walletId) {
      return { success: false, error: "Wallet not available" };
    }
    
    const { revokeSolanaDelegate } = await import("@/lib/solana/permissions");
    const result = await revokeSolanaDelegate(walletId, tokenAccountAddress);
    
    if (result.success) {
      await refetch();
    }
    
    return result;
  }, [walletId, refetch]);

  const delegatesList = delegates || [];
  const summary = computeSolanaPermissionsSummary(solanaSessions.length, delegatesList);

  return {
    sessions: solanaSessions,
    delegates: delegatesList,
    isLoading,
    isRefreshing,
    error: error as Error | null,
    refresh,
    disconnectSession,
    revokeDelegate,
    summary,
  };
}
