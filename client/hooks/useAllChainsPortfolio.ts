import { useState, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getNativeBalance, getERC20Balance, isBalanceError, BalanceResult } from "@/lib/blockchain/balances";
import { getTokensForChain } from "@/lib/blockchain/tokens";
import { supportedChains, getChainById } from "@/lib/blockchain/chains";
import { getApiUrl } from "@/lib/query-client";

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

      let prices: Record<string, { price: number; change24h?: number } | number> = {};
      try {
        const apiUrl = getApiUrl();
        const priceUrl = new URL("/api/prices", apiUrl);
        const priceResponse = await fetch(priceUrl.toString());
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
            headers: { "Content-Type": "application/json" },
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
