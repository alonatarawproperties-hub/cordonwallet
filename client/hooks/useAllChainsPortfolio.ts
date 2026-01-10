import { useState, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getNativeBalance, getERC20Balance, isBalanceError, BalanceResult } from "@/lib/blockchain/balances";
import { getTokensForChain } from "@/lib/blockchain/tokens";
import { supportedChains, getChainById } from "@/lib/blockchain/chains";

export interface MultiChainAsset {
  symbol: string;
  name: string;
  balance: string;
  rawBalance: bigint;
  decimals: number;
  isNative: boolean;
  address?: string;
  chainId: number;
  chainName: string;
}

export interface AllChainsPortfolioState {
  assets: MultiChainAsset[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
}

const CACHE_KEY_PREFIX = "@cordon/all_chains_portfolio_";
const CACHE_DURATION = 30000;

export function useAllChainsPortfolio(address: string | undefined) {
  const [state, setState] = useState<AllChainsPortfolioState>({
    assets: [],
    isLoading: true,
    isRefreshing: false,
    error: null,
    lastUpdated: null,
  });

  const isMounted = useRef(true);
  const lastFetchRef = useRef<string>("");

  const fetchAllBalances = useCallback(async (isRefresh = false) => {
    if (!address) {
      setState(prev => ({ ...prev, isLoading: false, assets: [] }));
      return;
    }

    const fetchKey = `all_${address}`;

    if (!isRefresh && fetchKey === lastFetchRef.current && state.assets.length > 0) {
      return;
    }

    lastFetchRef.current = fetchKey;

    setState(prev => ({
      ...prev,
      isLoading: !isRefresh,
      isRefreshing: isRefresh,
      error: null,
    }));

    const cacheKey = `${CACHE_KEY_PREFIX}${address}`;

    if (!isRefresh) {
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          const { assets, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_DURATION) {
            if (isMounted.current) {
              setState(prev => ({
                ...prev,
                assets: assets.map((a: any) => ({ ...a, rawBalance: BigInt(a.rawBalance) })),
                isLoading: false,
                lastUpdated: timestamp,
              }));
            }
            return;
          }
        }
      } catch {}
    }

    const allAssets: MultiChainAsset[] = [];
    let hasAnyError = false;
    let errorMessage = "";

    const chainPromises = supportedChains.map(async (chain) => {
      const chainAssets: MultiChainAsset[] = [];

      try {
        const nativeResult = await getNativeBalance(address, chain.chainId);

        if (!isBalanceError(nativeResult)) {
          chainAssets.push({
            symbol: chain.nativeSymbol,
            name: chain.name,
            balance: formatBalance(nativeResult.formatted),
            rawBalance: nativeResult.raw,
            decimals: nativeResult.decimals,
            isNative: true,
            chainId: chain.chainId,
            chainName: chain.name,
          });
        }

        const tokens = getTokensForChain(chain.chainId);

        const tokenResults = await Promise.allSettled(
          tokens.map(token =>
            getERC20Balance({
              tokenAddress: token.address,
              owner: address,
              chainId: chain.chainId,
              decimals: token.decimals,
              symbol: token.symbol,
            })
          )
        );

        tokenResults.forEach((result, index) => {
          if (result.status === "fulfilled" && !isBalanceError(result.value)) {
            const token = tokens[index];
            const balanceResult = result.value as BalanceResult;
            if (balanceResult.raw > 0n) {
              chainAssets.push({
                symbol: token.symbol,
                name: token.name,
                balance: formatBalance(balanceResult.formatted),
                rawBalance: balanceResult.raw,
                decimals: token.decimals,
                isNative: false,
                address: token.address,
                chainId: chain.chainId,
                chainName: chain.name,
              });
            }
          }
        });
      } catch (error) {
        hasAnyError = true;
        errorMessage = `Failed to load ${chain.name} assets`;
      }

      return chainAssets;
    });

    try {
      const results = await Promise.all(chainPromises);

      if (!isMounted.current) return;

      results.forEach(chainAssets => {
        allAssets.push(...chainAssets);
      });

      allAssets.sort((a, b) => {
        if (a.isNative && !b.isNative) return -1;
        if (!a.isNative && b.isNative) return 1;
        const aVal = Number(a.rawBalance);
        const bVal = Number(b.rawBalance);
        return bVal - aVal;
      });

      const now = Date.now();

      try {
        await AsyncStorage.setItem(cacheKey, JSON.stringify({
          assets: allAssets.map(a => ({ ...a, rawBalance: a.rawBalance.toString() })),
          timestamp: now,
        }));
      } catch {}

      if (isMounted.current) {
        setState({
          assets: allAssets,
          isLoading: false,
          isRefreshing: false,
          error: hasAnyError ? errorMessage : null,
          lastUpdated: now,
        });
      }
    } catch (error) {
      if (isMounted.current) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          isRefreshing: false,
          error: error instanceof Error ? error.message : "Failed to fetch balances",
        }));
      }
    }
  }, [address]);

  useEffect(() => {
    isMounted.current = true;
    lastFetchRef.current = "";
    fetchAllBalances(false);

    return () => {
      isMounted.current = false;
    };
  }, [fetchAllBalances]);

  const refresh = useCallback(() => {
    fetchAllBalances(true);
  }, [fetchAllBalances]);

  return {
    ...state,
    refresh,
  };
}

function formatBalance(value: string): string {
  const num = parseFloat(value);
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(4);
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
