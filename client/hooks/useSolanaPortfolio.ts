import { useState, useEffect, useCallback, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";
import { getCustomTokens, getHiddenTokens, CustomToken } from "@/lib/token-preferences";
import { getPreloadedCache, clearPreloadedCache, getDefaultNativeTokens } from "@/lib/portfolio-cache";

const POLLING_INTERVAL = 60000; // 60 seconds - less disruptive

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
  logoUrl?: string;
}

export interface SolanaPortfolioState {
  assets: SolanaAsset[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  lastUpdated: number | null;
}

const CACHE_KEY_PREFIX = "@cordon/solana_portfolio_v2_";
const CACHE_DURATION = 30000;

export function useSolanaPortfolio(address: string | undefined) {
  // Initialize with default native SOL token for instant visual feedback
  const defaultSolAsset = getDefaultNativeTokens().solana;
  
  const [state, setState] = useState<SolanaPortfolioState>(() => ({
    assets: address ? defaultSolAsset : [],
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
      console.log("[SolanaPortfolio] Address changed from", currentAddressRef.current, "to", address, "- clearing state");
      currentAddressRef.current = address;
      lastFetchRef.current = ""; // Reset fetch tracking
      // Clear state immediately to prevent cross-wallet data leakage
      setState({
        assets: address ? defaultSolAsset : [],
        isLoading: true,
        isRefreshing: false,
        error: null,
        lastUpdated: null,
      });
    }
  }, [address, defaultSolAsset]);

  const fetchBalances = useCallback(async (isRefresh = false, isSilent = false) => {
    if (!address) {
      setState(prev => ({ ...prev, isLoading: false, assets: [] }));
      return;
    }

    // Capture the address at the start of this fetch for race condition prevention
    const fetchAddress = address;
    const fetchKey = `solana_${address}`;

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

    let customTokenMap: Map<string, CustomToken> = new Map();
    try {
      const customTokens = await getCustomTokens();
      // Accept both chainId 0 (number) and "solana" (string) for Solana tokens
      const solanaCustomTokens = customTokens.filter((ct: CustomToken) => 
        ct.chainId === 0 || (ct.chainId as any) === "solana"
      );
      solanaCustomTokens.forEach((ct: CustomToken) => {
        customTokenMap.set(ct.contractAddress.toLowerCase(), ct);
      });
    } catch {}


    if (!isRefresh) {
      const preloadedCache = getPreloadedCache();
      if (preloadedCache && preloadedCache.solanaAddress === address && preloadedCache.solanaAssets.length > 0) {
        console.log("[SolanaPortfolio] Using preloaded cache with", preloadedCache.solanaAssets.length, "assets");
        if (isFetchValid()) {
          setState(prev => ({
            ...prev,
            assets: preloadedCache.solanaAssets,
            isLoading: false,
            lastUpdated: preloadedCache.timestamp,
          }));
        }
        fetchBalances(true);
        return;
      }

      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached) {
          const { assets, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_DURATION) {
            if (isFetchValid()) {
              const enrichedAssets = assets.map((a: any) => {
                const asset = { ...a, rawBalance: BigInt(a.rawBalance) };
                if (asset.mint) {
                  const customToken = customTokenMap.get(asset.mint.toLowerCase());
                  if (customToken) {
                    asset.symbol = customToken.symbol;
                    asset.name = customToken.name;
                    asset.logoUrl = customToken.logoUrl;
                  }
                }
                return asset;
              });
              setState(prev => ({
                ...prev,
                assets: enrichedAssets,
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

      let hiddenTokens: string[] = [];
      try {
        hiddenTokens = await getHiddenTokens();
      } catch {}

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
        logoUrl: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
      });

      portfolio.tokens.forEach((token) => {
        // Check if this token has custom metadata saved by the user
        const customToken = customTokenMap.get(token.mint.toLowerCase());
        const symbol = customToken?.symbol || token.symbol || shortenMint(token.mint);
        
        // Check if this token is hidden (chainId 0 = Solana)
        const tokenKey = `0:${symbol}`;
        if (hiddenTokens.includes(tokenKey)) return;
        
        assets.push({
          symbol,
          name: customToken?.name || token.name || `Token ${shortenMint(token.mint)}`,
          balance: formatBalance(token.uiAmount.toString()),
          rawBalance: BigInt(token.amount),
          decimals: token.decimals,
          isNative: false,
          mint: token.mint,
          tokenAccount: token.tokenAccount,
          chainId: "solana",
          chainName: "Solana",
          logoUrl: customToken?.logoUrl || token.logoUrl,
        });
      });

      // Add custom Solana tokens that aren't in RPC results (zero balance tokens user wants to track)
      customTokenMap.forEach((ct, mintLower) => {
        const tokenKey = `${ct.chainId}:${ct.symbol}`;
        if (hiddenTokens.includes(tokenKey)) return;
        
        // Check if we already have this token from RPC
        const existingToken = assets.find(a => a.mint?.toLowerCase() === mintLower);
        if (existingToken) return;
        
        // Add custom token with zero balance
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
          logoUrl: ct.logoUrl,
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

      // Fetch prices and metadata for SPL tokens
      const tokensWithMint = assets.filter(a => a.mint && !a.isNative);
      const apiUrl = getApiUrl();
      
      if (tokensWithMint.length > 0) {
        // First, fetch metadata for tokens that need it (truncated names or missing metadata)
        const tokensNeedingMetadata = tokensWithMint.filter(t => 
          t.symbol.includes("...") || t.name.includes("Token ") || !t.logoUrl
        );
        
        // Fetch metadata from dedicated endpoint (uses DexScreener + Metaplex)
        if (tokensNeedingMetadata.length > 0) {
          try {
            const metadataPromises = tokensNeedingMetadata.map(async (token) => {
              try {
                const metaUrl = new URL(`/api/solana/token-metadata/${token.mint}`, apiUrl);
                const response = await fetch(metaUrl.toString());
                if (response.ok) {
                  const metadata = await response.json();
                  return { mint: token.mint!, metadata };
                }
              } catch {}
              return null;
            });
            
            const results = await Promise.all(metadataPromises);
            results.forEach((result) => {
              if (result?.metadata) {
                const token = tokensWithMint.find(t => t.mint === result.mint);
                if (token) {
                  if (result.metadata.symbol) {
                    token.symbol = result.metadata.symbol;
                  }
                  if (result.metadata.name) {
                    token.name = result.metadata.name;
                  }
                  if (result.metadata.logoUri) {
                    token.logoUrl = result.metadata.logoUri;
                  }
                  console.log(`[Solana Portfolio] Enriched ${token.symbol} with metadata from server`);
                }
              }
            });
          } catch (metadataError) {
            console.log("[Solana Portfolio] Token metadata fetch failed:", metadataError);
          }
        }
        
        // Then fetch prices via batch DexScreener API
        try {
          const mintAddresses = tokensWithMint.map(t => t.mint).join(",");
          const dexUrl = new URL("/api/dexscreener/tokens", apiUrl);
          dexUrl.searchParams.set("addresses", mintAddresses);
          dexUrl.searchParams.set("chainId", "solana");
          
          const dexResponse = await fetch(dexUrl.toString());
          if (dexResponse.ok) {
            const dexData = await dexResponse.json();
            if (dexData.prices) {
              const pricesLowercase: Record<string, any> = {};
              Object.entries(dexData.prices).forEach(([addr, info]) => {
                pricesLowercase[addr.toLowerCase()] = info;
              });
              
              tokensWithMint.forEach((token) => {
                const priceInfo = pricesLowercase[token.mint!.toLowerCase()];
                if (priceInfo) {
                  token.priceUsd = priceInfo.price;
                  token.priceChange24h = priceInfo.change24h;
                  const balanceNum = parseFloat(token.balance.replace(/,/g, "")) || 0;
                  token.valueUsd = priceInfo.price * balanceNum;
                  console.log(`[Solana Portfolio] Set price for ${token.symbol}: $${priceInfo.price}`);
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

      if (isFetchValid()) {
        setState({
          assets,
          isLoading: false,
          isRefreshing: false,
          error: null,
          lastUpdated: now,
        });
      }
    } catch (error) {
      if (isFetchValid()) {
        // Provide user-friendly error messages
        let errorMessage = "Failed to fetch Solana balances";
        if (error instanceof Error) {
          const msg = error.message.toLowerCase();
          if (msg.includes("network request failed") || msg.includes("fetch")) {
            errorMessage = "Network request failed";
          } else if (msg.includes("403") || msg.includes("forbidden")) {
            errorMessage = "RPC access denied - using cached data";
          } else if (msg.includes("timeout")) {
            errorMessage = "Request timed out";
          } else {
            errorMessage = error.message;
          }
        }
        
        setState(prev => ({
          ...prev,
          isLoading: false,
          isRefreshing: false,
          error: errorMessage,
        }));
      }
    }
  }, [address]);

  useEffect(() => {
    isMounted.current = true;
    lastFetchRef.current = "";
    fetchBalances(false);

    const pollInterval = setInterval(() => {
      if (isMounted.current && address) {
        console.log("[SolanaPortfolio] Auto-refresh triggered (silent)");
        fetchBalances(true, true); // silent refresh
      }
    }, POLLING_INTERVAL);

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "active" && isMounted.current && address) {
        console.log("[SolanaPortfolio] App became active, refreshing (silent)");
        fetchBalances(true, true); // silent refresh
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      isMounted.current = false;
      clearInterval(pollInterval);
      subscription.remove();
    };
  }, [fetchBalances, address]);

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
