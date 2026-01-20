import { useState, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getNativeBalance, getERC20Balance, isBalanceError, BalanceResult } from "@/lib/blockchain/balances";
import { getTokensForChain, TokenInfo } from "@/lib/blockchain/tokens";
import { getChainById } from "@/lib/blockchain/chains";
import { NETWORKS, NetworkId } from "@/lib/types";
import { getApiUrl } from "@/lib/query-client";
import { useWallet } from "@/lib/wallet-context";

export interface PortfolioAsset {
  symbol: string;
  name: string;
  balance: string;
  rawBalance: bigint;
  decimals: number;
  isNative: boolean;
  address?: string;
  priceUsd?: number;
  logoURI?: string | null;
}

export interface PortfolioState {
  assets: PortfolioAsset[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
  rpcLatency: number | null;
}

const CACHE_KEY_PREFIX = "@cordon/portfolio_cache_";
const CACHE_DURATION = 30000;

function getChainIdFromNetworkId(networkId: NetworkId): number {
  return NETWORKS[networkId].chainId;
}

export function usePortfolio(address: string | undefined, networkId: NetworkId) {
  const { portfolioRefreshNonce } = useWallet();
  const [state, setState] = useState<PortfolioState>({
    assets: [],
    isLoading: true,
    isRefreshing: false,
    error: null,
    lastUpdated: null,
    rpcLatency: null,
  });
  
  const isMounted = useRef(true);
  const lastFetchRef = useRef<string>("");
  // Track current address for race condition prevention
  const currentAddressRef = useRef<string | undefined>(address);

  // Clear state immediately when address changes to prevent showing stale data
  useEffect(() => {
    if (address !== currentAddressRef.current) {
      console.log("[Portfolio] Address changed from", currentAddressRef.current, "to", address, "- clearing state");
      currentAddressRef.current = address;
      lastFetchRef.current = ""; // Reset fetch tracking
      // Clear state immediately to prevent cross-wallet data leakage
      setState({
        assets: [],
        isLoading: true,
        isRefreshing: false,
        error: null,
        lastUpdated: null,
        rpcLatency: null,
      });
    }
  }, [address]);

  // Reset fetch tracking when nonce changes (wallet switch/add)
  useEffect(() => {
    lastFetchRef.current = "";
  }, [portfolioRefreshNonce]);

  const fetchBalances = useCallback(async (isRefresh = false) => {
    if (!address) {
      setState(prev => ({ ...prev, isLoading: false, assets: [] }));
      return;
    }

    // Capture the address at the start of this fetch for race condition prevention
    const fetchAddress = address;
    const chainId = getChainIdFromNetworkId(networkId);
    const chain = getChainById(chainId);
    
    if (!chain) {
      setState(prev => ({ 
        ...prev, 
        isLoading: false, 
        error: "Unsupported network" 
      }));
      return;
    }

    const fetchKey = `${address}_${chainId}_${portfolioRefreshNonce}`;
    
    if (!isRefresh && fetchKey === lastFetchRef.current && state.assets.length > 0) {
      return;
    }
    
    lastFetchRef.current = fetchKey;
    
    // Helper to check if this fetch is still valid (address hasn't changed)
    const isFetchValid = () => currentAddressRef.current === fetchAddress && isMounted.current;

    setState(prev => ({ 
      ...prev, 
      isLoading: !isRefresh, 
      isRefreshing: isRefresh,
      error: null 
    }));

    const cacheKey = `${CACHE_KEY_PREFIX}${chainId}_${address}`;
    
    if (!isRefresh) {
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          const { assets, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_DURATION) {
            if (isFetchValid()) {
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

    const startTime = Date.now();
    const assets: PortfolioAsset[] = [];
    let hasRpcError = false;
    let errorMessage = "";

    try {
      const nativeResult = await getNativeBalance(address, chainId);
      
      if (!isFetchValid()) return;
      
      if (isBalanceError(nativeResult)) {
        hasRpcError = true;
        errorMessage = nativeResult.error.message;
      } else {
        assets.push({
          symbol: chain.nativeSymbol,
          name: chain.name,
          balance: formatBalance(nativeResult.formatted),
          rawBalance: nativeResult.raw,
          decimals: nativeResult.decimals,
          isNative: true,
        });
      }

      let useDiscoveryApi = true;
      const apiUrl = getApiUrl();

      try {
        const discoveryUrl = new URL(`/api/evm/${chainId}/${address}/tokens`, apiUrl);
        const discoveryResponse = await fetch(discoveryUrl.toString(), {
          signal: AbortSignal.timeout(10000),
        });
        
        if (!isFetchValid()) return;

        if (discoveryResponse.ok) {
          const discoveryData = await discoveryResponse.json();
          const discoveredTokens = discoveryData.tokens || [];
          
          console.log(`[Portfolio] Discovery API found ${discoveredTokens.length} tokens`);
          
          for (const token of discoveredTokens) {
            if (token.balanceRaw && BigInt(token.balanceRaw) > 0n) {
              assets.push({
                symbol: token.symbol,
                name: token.name,
                balance: token.balanceFormatted || formatBalance(token.balanceRaw),
                rawBalance: BigInt(token.balanceRaw),
                decimals: token.decimals,
                isNative: false,
                address: token.address,
                priceUsd: token.priceUsd || undefined,
                logoURI: token.logoURI,
              });
            }
          }
        } else {
          let errorCode = "UNKNOWN";
          let errorMessage = `HTTP ${discoveryResponse.status}`;
          let retryAfterSec: number | undefined;
          
          try {
            const errorData = await discoveryResponse.json();
            if (errorData.error?.code) {
              errorCode = errorData.error.code;
              errorMessage = errorData.error.message || errorMessage;
              retryAfterSec = errorData.error.retryAfterSec;
            }
          } catch {}
          
          console.log("[Portfolio] Discovery API failed", {
            status: discoveryResponse.status,
            code: errorCode,
            message: errorMessage,
            retryAfterSec,
          });
          
          useDiscoveryApi = false;
        }
      } catch (discoveryError: any) {
        const isTimeout = discoveryError.name === "TimeoutError" || discoveryError.name === "AbortError";
        console.log("[Portfolio] Discovery API error", {
          type: isTimeout ? "timeout" : "network",
          message: discoveryError.message,
        });
        useDiscoveryApi = false;
      }

      if (!useDiscoveryApi) {
        const tokens = getTokensForChain(chainId);
        
        const tokenResults = await Promise.allSettled(
          tokens.map(token => 
            getERC20Balance({
              tokenAddress: token.address,
              owner: address,
              chainId,
              decimals: token.decimals,
              symbol: token.symbol,
            })
          )
        );

        if (!isFetchValid()) return;

        let tokenErrors = 0;
        tokenResults.forEach((result, index) => {
          if (result.status === "fulfilled") {
            if (isBalanceError(result.value)) {
              tokenErrors++;
            } else {
              const token = tokens[index];
              const balanceResult = result.value as BalanceResult;
              if (balanceResult.raw > 0n) {
                assets.push({
                  symbol: token.symbol,
                  name: token.name,
                  balance: formatBalance(balanceResult.formatted),
                  rawBalance: balanceResult.raw,
                  decimals: token.decimals,
                  isNative: false,
                  address: token.address,
                });
              }
            }
          } else {
            tokenErrors++;
          }
        });

        if (tokenErrors > 0 && !hasRpcError) {
          errorMessage = `Failed to load ${tokenErrors} token${tokenErrors > 1 ? "s" : ""}`;
        }
      }

      try {
        const priceUrl = new URL("/api/prices", apiUrl);
        const priceResponse = await fetch(priceUrl.toString());
        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          const prices = priceData.prices || {};
          assets.forEach(asset => {
            if (!asset.priceUsd && prices[asset.symbol]) {
              asset.priceUsd = prices[asset.symbol].usd;
            }
          });
        }
      } catch {}

      const rpcLatency = Date.now() - startTime;
      const now = Date.now();

      try {
        await AsyncStorage.setItem(cacheKey, JSON.stringify({
          assets: assets.map(a => ({ ...a, rawBalance: a.rawBalance.toString() })),
          timestamp: now,
        }));
      } catch {}

      if (isFetchValid()) {
        if (hasRpcError && assets.length === 0) {
          setState({
            assets: [],
            isLoading: false,
            isRefreshing: false,
            error: errorMessage || "Failed to connect to network",
            lastUpdated: null,
            rpcLatency,
          });
        } else {
          setState({
            assets,
            isLoading: false,
            isRefreshing: false,
            error: errorMessage || null,
            lastUpdated: now,
            rpcLatency,
          });
        }
      }
    } catch (error) {
      if (isFetchValid()) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          isRefreshing: false,
          error: error instanceof Error ? error.message : "Failed to fetch balances",
        }));
      }
    }
  }, [address, networkId]);

  useEffect(() => {
    isMounted.current = true;
    lastFetchRef.current = "";
    fetchBalances(false);
    
    return () => {
      isMounted.current = false;
    };
  }, [fetchBalances]);

  const refresh = useCallback(() => {
    fetchBalances(true);
  }, [fetchBalances]);

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

export function formatTimeSince(timestamp: number | null): string {
  if (!timestamp) return "";
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
