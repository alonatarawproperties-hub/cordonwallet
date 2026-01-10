import { useState, useEffect, useCallback, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";
import { getCustomTokens, getHiddenTokens, CustomToken } from "@/lib/token-preferences";

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

      // Add custom Solana tokens (chainId 0) that aren't hidden
      try {
        const [customTokens, hiddenTokens] = await Promise.all([
          getCustomTokens(),
          getHiddenTokens(),
        ]);
        
        const solanaCustomTokens = customTokens.filter((ct: CustomToken) => ct.chainId === 0);
        
        solanaCustomTokens.forEach((ct: CustomToken) => {
          const tokenKey = `${ct.chainId}:${ct.symbol}`;
          if (hiddenTokens.includes(tokenKey)) return;
          
          // Check if we already have this token from the RPC
          const existingToken = assets.find(a => a.mint === ct.contractAddress);
          if (existingToken) return;
          
          // Add custom token with zero balance (actual balance comes from RPC if they hold it)
          assets.push({
            symbol: ct.symbol,
            name: ct.name,
            balance: "0",
            rawBalance: BigInt(0),
            decimals: ct.decimals,
            isNative: false,
            mint: ct.contractAddress,
            chainId: "solana",
            chainName: "Solana",
          });
        });
      } catch (customTokenError) {
        console.log("[Solana Portfolio] Failed to load custom tokens:", customTokenError);
      }

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

      // Fetch prices for SPL tokens via DexScreener
      const tokensWithMint = assets.filter(a => a.mint && !a.isNative);
      if (tokensWithMint.length > 0) {
        try {
          const apiUrl = getApiUrl();
          const mintAddresses = tokensWithMint.map(t => t.mint).join(",");
          const dexUrl = new URL("/api/dexscreener/tokens", apiUrl);
          dexUrl.searchParams.set("addresses", mintAddresses);
          dexUrl.searchParams.set("chainId", "solana");
          
          const dexResponse = await fetch(dexUrl.toString());
          if (dexResponse.ok) {
            const dexData = await dexResponse.json();
            if (dexData.prices) {
              tokensWithMint.forEach((token) => {
                const priceInfo = dexData.prices[token.mint!];
                if (priceInfo) {
                  token.priceUsd = priceInfo.price;
                  token.priceChange24h = priceInfo.change24h;
                  const balanceNum = parseFloat(token.balance.replace(/,/g, "")) || 0;
                  token.valueUsd = priceInfo.price * balanceNum;
                }
              });
            }
          }
        } catch (dexError) {
          console.log("[Solana Portfolio] DexScreener price fetch failed:", dexError);
        }
      }

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
