import { useState, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";

interface SolBalance {
  lamports: number;
  sol: string;
}

interface SplTokenBalance {
  mint: string;
  tokenAccount: string;
  amount: string;
  decimals: number;
  uiAmount: number;
  symbol?: string;
  name?: string;
}

interface SolanaPortfolio {
  nativeBalance: SolBalance;
  tokens: SplTokenBalance[];
}

async function fetchSolanaPortfolio(address: string): Promise<SolanaPortfolio> {
  const apiUrl = getApiUrl();
  const url = new URL(`/api/solana/portfolio/${address}`, apiUrl);
  const response = await fetch(url.toString());
  
  if (!response.ok) {
    throw new Error("Failed to fetch Solana portfolio");
  }
  
  return response.json();
}

export interface SolanaAsset {
  symbol: string;
  name: string;
  balance: string;
  rawBalance: bigint;
  decimals: number;
  isNative: boolean;
  mint?: string;
  tokenAccount?: string;
  chainId: string;
  chainName: string;
  priceUsd?: number;
  valueUsd?: number;
  priceChange24h?: number;
}

export interface SolanaPortfolioState {
  assets: SolanaAsset[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
}

const CACHE_KEY_PREFIX = "@cordon/solana_portfolio_v1_";
const CACHE_DURATION = 30000;

export function useSolanaPortfolio(address: string | undefined) {
  const [state, setState] = useState<SolanaPortfolioState>({
    assets: [],
    isLoading: true,
    isRefreshing: false,
    error: null,
    lastUpdated: null,
  });

  const isMounted = useRef(true);
  const lastFetchRef = useRef<string>("");

  const fetchBalances = useCallback(async (isRefresh = false) => {
    if (!address) {
      setState(prev => ({ ...prev, isLoading: false, assets: [] }));
      return;
    }

    const fetchKey = `solana_${address}`;

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

    try {
      const portfolio = await fetchSolanaPortfolio(address);
      const assets: SolanaAsset[] = [];

      const solBalanceNum = parseFloat(portfolio.nativeBalance.sol);
      assets.push({
        symbol: "SOL",
        name: "Solana",
        balance: formatBalance(portfolio.nativeBalance.sol),
        rawBalance: BigInt(portfolio.nativeBalance.lamports),
        decimals: 9,
        isNative: true,
        chainId: "solana",
        chainName: "Solana",
      });

      portfolio.tokens.forEach((token) => {
        assets.push({
          symbol: token.symbol || shortenMint(token.mint),
          name: token.name || `Token ${shortenMint(token.mint)}`,
          balance: formatBalance(token.uiAmount.toString()),
          rawBalance: BigInt(token.amount),
          decimals: token.decimals,
          isNative: false,
          mint: token.mint,
          tokenAccount: token.tokenAccount,
          chainId: "solana",
          chainName: "Solana",
        });
      });

      let solPrice = 0;
      let solChange24h = 0;
      try {
        const apiUrl = getApiUrl();
        const priceUrl = new URL("/api/prices", apiUrl);
        const priceResponse = await fetch(priceUrl.toString());
        if (priceResponse.ok) {
          const priceData = await priceResponse.json();
          const prices = priceData.prices || {};
          if (prices.SOL) {
            if (typeof prices.SOL === "number") {
              solPrice = prices.SOL;
            } else if (prices.SOL.price) {
              solPrice = prices.SOL.price;
              solChange24h = prices.SOL.change24h || 0;
            }
          }
        }
      } catch {}

      assets.forEach((asset) => {
        if (asset.symbol === "SOL") {
          asset.priceUsd = solPrice;
          asset.priceChange24h = solChange24h;
          const balanceNum = parseFloat(asset.balance.replace(/,/g, "")) || 0;
          asset.valueUsd = solPrice * balanceNum;
        }
      });

      assets.sort((a, b) => {
        if (a.isNative && !b.isNative) return -1;
        if (!a.isNative && b.isNative) return 1;
        return (b.valueUsd || 0) - (a.valueUsd || 0);
      });

      const now = Date.now();

      try {
        await AsyncStorage.setItem(cacheKey, JSON.stringify({
          assets: assets.map(a => ({ ...a, rawBalance: a.rawBalance.toString() })),
          timestamp: now,
        }));
      } catch {}

      if (isMounted.current) {
        setState({
          assets,
          isLoading: false,
          isRefreshing: false,
          error: null,
          lastUpdated: now,
        });
      }
    } catch (error) {
      if (isMounted.current) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          isRefreshing: false,
          error: error instanceof Error ? error.message : "Failed to fetch Solana balances",
        }));
      }
    }
  }, [address]);

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

function shortenMint(mint: string): string {
  if (mint.length <= 8) return mint;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}
