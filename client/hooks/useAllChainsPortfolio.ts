import { useState, useEffect, useCallback, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getNativeBalance, getERC20Balance, isBalanceError, BalanceResult } from "@/lib/blockchain/balances";
import { getTokensForChain } from "@/lib/blockchain/tokens";
import { supportedChains, getChainById } from "@/lib/blockchain/chains";
import { getApiUrl, getApiHeaders } from "@/lib/query-client";
import { getPreloadedCache, clearPreloadedCache, savePortfolioDisplayCache, getDefaultNativeTokens } from "@/lib/portfolio-cache";
import { useWallet } from "@/lib/wallet-context";

const POLLING_INTERVAL = 60000; // 60 seconds - less disruptive

function createTimeoutSignal(ms: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

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
  priceUsd?: number;
  valueUsd?: number;
  priceChange24h?: number;
  logoURI?: string;
}

export interface AllChainsPortfolioState {
  assets: MultiChainAsset[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
}

const CACHE_KEY_PREFIX = "@cordon/all_chains_portfolio_v2_";
const CACHE_DURATION = 30000;

export function useAllChainsPortfolio(address: string | undefined) {
  const { portfolioRefreshNonce } = useWallet();
  // Initialize with default native tokens for instant visual feedback
  const defaultEvmAssets = getDefaultNativeTokens().evm;
  
  const [state, setState] = useState<AllChainsPortfolioState>(() => ({
    assets: address ? defaultEvmAssets : [],
    isLoading: true,
    isRefreshing: false,
    error: null,
    lastUpdated: null,
  }));

  const isMounted = useRef(true);
  const lastFetchRef = useRef<string>("");
  // Track current address for race condition prevention
  const currentAddressRef = useRef<string | undefined>(address);

  // Clear state immediately when address changes to prevent showing stale data
  useEffect(() => {
    if (address !== currentAddressRef.current) {
      console.log("[EVMPortfolio] Address changed from", currentAddressRef.current, "to", address, "- clearing state");
      currentAddressRef.current = address;
      lastFetchRef.current = ""; // Reset fetch tracking
      // Clear state immediately to prevent cross-wallet data leakage
      setState({
        assets: address ? defaultEvmAssets : [],
        isLoading: true,
        isRefreshing: false,
        error: null,
        lastUpdated: null,
      });
    }
  }, [address, defaultEvmAssets]);

  // Reset fetch tracking when nonce changes (wallet switch/add)
  useEffect(() => {
    lastFetchRef.current = "";
  }, [portfolioRefreshNonce]);

  const fetchAllBalances = useCallback(async (isRefresh = false, isSilent = false) => {
    if (!address) {
      setState(prev => ({ ...prev, isLoading: false, assets: [] }));
      return;
    }

    // Capture the address at the start of this fetch for race condition prevention
    const fetchAddress = address;
    const fetchKey = `all_${address}_${portfolioRefreshNonce}`;

    if (!isRefresh && fetchKey === lastFetchRef.current && state.assets.length > 0) {
      return;
    }

    lastFetchRef.current = fetchKey;
    
    // Helper to check if this fetch is still valid (address hasn't changed)
    const isFetchValid = () => currentAddressRef.current === fetchAddress && isMounted.current;

    // Only show loading/refreshing UI for non-silent refreshes
    if (!isSilent) {
      setState(prev => ({
        ...prev,
        isLoading: !isRefresh,
        isRefreshing: isRefresh,
        error: null,
      }));
    }

    const cacheKey = `${CACHE_KEY_PREFIX}${address}`;

    if (!isRefresh) {
      const preloadedCache = getPreloadedCache();
      if (preloadedCache && preloadedCache.evmAddress === address && preloadedCache.evmAssets.length > 0) {
        console.log("[Portfolio] Using preloaded cache with", preloadedCache.evmAssets.length, "assets");
        if (isFetchValid()) {
          setState(prev => ({
            ...prev,
            assets: preloadedCache.evmAssets,
            isLoading: false,
            lastUpdated: preloadedCache.timestamp,
          }));
        }
        clearPreloadedCache();
        fetchAllBalances(true);
        return;
      }

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

        let useDiscoveryApi = true;
        const apiUrl = getApiUrl();

        const { signal: timeoutSignal, cleanup: cleanupTimeout } = createTimeoutSignal(8000);
        try {
          const discoveryUrl = new URL(`/api/evm/${chain.chainId}/${address}/tokens`, apiUrl);
          const discoveryResponse = await fetch(discoveryUrl.toString(), {
            signal: timeoutSignal,
            headers: getApiHeaders(),
          });
          cleanupTimeout();

          if (discoveryResponse.ok) {
            const discoveryData = await discoveryResponse.json();
            const discoveredTokens = discoveryData.tokens || [];

            console.log(`[AllChainsPortfolio] Discovery ${chain.chainId} found ${discoveredTokens.length} tokens`);

            for (const token of discoveredTokens) {
              if (token.balanceRaw && BigInt(token.balanceRaw) > 0n) {
                chainAssets.push({
                  symbol: token.symbol,
                  name: token.name,
                  balance: token.balanceFormatted || formatBalance(token.balanceRaw),
                  rawBalance: BigInt(token.balanceRaw),
                  decimals: token.decimals,
                  isNative: false,
                  address: token.address,
                  chainId: chain.chainId,
                  chainName: chain.name,
                  priceUsd: token.priceUsd || undefined,
                  logoURI: token.logoURI || undefined,
                });
              }
            }
          } else {
            let errorCode = "UNKNOWN";
            let errorMessage = `HTTP ${discoveryResponse.status}`;
            try {
              const errorData = await discoveryResponse.json();
              if (errorData.error?.code) {
                errorCode = errorData.error.code;
                errorMessage = errorData.error.message || errorMessage;
              }
            } catch {}
            console.log(`[AllChainsPortfolio] Discovery failed for ${chain.chainId}, fallback to hardcoded: ${errorCode} - ${errorMessage}`);
            useDiscoveryApi = false;
          }
        } catch (discoveryError: any) {
          cleanupTimeout();
          const isTimeout = discoveryError.name === "TimeoutError" || discoveryError.name === "AbortError";
          console.log(`[AllChainsPortfolio] Discovery failed for ${chain.chainId}, fallback to hardcoded: ${isTimeout ? "timeout" : discoveryError.message}`);
          useDiscoveryApi = false;
        }

        if (!useDiscoveryApi) {
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
        }
      } catch (error) {
        hasAnyError = true;
        errorMessage = `Failed to load ${chain.name} assets`;
      }

      return chainAssets;
    });

    try {
      const results = await Promise.all(chainPromises);

      if (!isFetchValid()) return;

      results.forEach(chainAssets => {
        allAssets.push(...chainAssets);
      });

      let prices: Record<string, { price: number; change24h?: number } | number> = {};
      try {
        const apiUrl = getApiUrl();
        const priceUrl = new URL("/api/prices", apiUrl);
        const priceResponse = await fetch(priceUrl.toString(), { headers: getApiHeaders() });
        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          prices = priceData.prices || {};
          console.log("[Portfolio] Fetched prices:", Object.keys(prices));
        }
      } catch (priceError) {
        console.log("[Portfolio] Failed to fetch prices:", priceError);
      }

      // Helper to extract price from old or new format
      const extractPrice = (data: { price: number; change24h?: number } | number | undefined): { price: number; change24h?: number } | null => {
        if (!data) return null;
        if (typeof data === "number") {
          return { price: data };
        }
        return data;
      };

      // Apply CoinGecko prices first
      allAssets.forEach((asset) => {
        const priceKey = asset.isNative ? `native_${asset.chainId}` : asset.symbol;
        const symbolPriceData = extractPrice(prices[asset.symbol]);
        const nativePriceData = extractPrice(prices[priceKey]);
        const priceData = symbolPriceData || nativePriceData;
        
        if (priceData && priceData.price) {
          asset.priceUsd = priceData.price;
          asset.priceChange24h = priceData.change24h;
          console.log(`[Portfolio] Price for ${asset.symbol}: $${priceData.price} (${priceData.change24h?.toFixed(2)}%)`);
        } else {
          asset.priceUsd = 0;
          console.log(`[Portfolio] No price for ${asset.symbol} (keys tried: ${asset.symbol}, ${priceKey})`);
        }
        
        const balanceNum = parseFloat(asset.balance.replace(/,/g, "")) || 0;
        asset.valueUsd = (asset.priceUsd || 0) * balanceNum;
      });

      // Find tokens without prices and fetch from DexScreener
      const tokensWithoutPrice = allAssets.filter(
        (a) => !a.isNative && a.address && !a.priceUsd
      );

      if (tokensWithoutPrice.length > 0) {
        try {
          const apiUrl = getApiUrl();
          const dexUrl = new URL("/api/dexscreener/tokens", apiUrl);
          const dexResponse = await fetch(dexUrl.toString(), {
            method: "POST",
            headers: getApiHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              tokens: tokensWithoutPrice.map((t) => ({
                chainId: t.chainId,
                address: t.address,
              })),
            }),
          });

          if (dexResponse.ok) {
            const dexData = await dexResponse.json();
            const dexPrices = dexData.tokens || {};

            // Map DexScreener chain IDs
            const dexChainMap: Record<number, string> = {
              1: "ethereum",
              137: "polygon",
              56: "bsc",
              42161: "arbitrum",
            };

            tokensWithoutPrice.forEach((asset) => {
              const dexChainId = dexChainMap[asset.chainId];
              const key = `${dexChainId}_${asset.address?.toLowerCase()}`;
              const dexPrice = dexPrices[key];
              if (dexPrice?.price) {
                const price = dexPrice.price as number;
                asset.priceUsd = price;
                asset.priceChange24h = dexPrice.priceChange24h as number | undefined;
                const balanceNum = parseFloat(asset.balance.replace(/,/g, "")) || 0;
                asset.valueUsd = price * balanceNum;
                console.log(`[Portfolio] DexScreener price for ${asset.symbol}: $${price}`);
              }
            });
          }
        } catch (dexError) {
          console.log("[Portfolio] DexScreener fallback failed:", dexError);
        }
      }

      allAssets.sort((a, b) => {
        if (a.isNative && !b.isNative) return -1;
        if (!a.isNative && b.isNative) return 1;
        return (b.valueUsd || 0) - (a.valueUsd || 0);
      });

      const now = Date.now();

      try {
        await AsyncStorage.setItem(cacheKey, JSON.stringify({
          assets: allAssets.map(a => ({ ...a, rawBalance: a.rawBalance.toString() })),
          timestamp: now,
        }));
      } catch {}

      if (isFetchValid()) {
        setState({
          assets: allAssets,
          isLoading: false,
          isRefreshing: false,
          error: hasAnyError ? errorMessage : null,
          lastUpdated: now,
        });
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
  }, [address]);

  useEffect(() => {
    isMounted.current = true;
    lastFetchRef.current = "";
    fetchAllBalances(false);

    const pollInterval = setInterval(() => {
      if (isMounted.current && address) {
        console.log("[EVMPortfolio] Auto-refresh triggered (silent)");
        fetchAllBalances(true, true); // silent refresh
      }
    }, POLLING_INTERVAL);

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "active" && isMounted.current && address) {
        console.log("[EVMPortfolio] App became active, refreshing (silent)");
        fetchAllBalances(true, true); // silent refresh
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      isMounted.current = false;
      clearInterval(pollInterval);
      subscription.remove();
    };
  }, [fetchAllBalances, address]);

  const refresh = useCallback(() => {
    return fetchAllBalances(true);
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
