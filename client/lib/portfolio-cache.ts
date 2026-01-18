import AsyncStorage from "@react-native-async-storage/async-storage";
import { MultiChainAsset } from "@/hooks/useAllChainsPortfolio";
import { SolanaAsset } from "@/hooks/useSolanaPortfolio";

const PORTFOLIO_CACHE_KEY = "@cordon/all_chains_portfolio_v2_";
const SOLANA_CACHE_KEY = "@cordon/solana_portfolio_v2_";
// Display cache is now wallet-scoped: @cordon/portfolio_display_cache_{evmAddr}_{solAddr}
const DISPLAY_CACHE_KEY_PREFIX = "@cordon/portfolio_display_cache_";
const INSTANT_CACHE_DURATION = 300000;

export interface PortfolioDisplayCache {
  evmAssets: MultiChainAsset[];
  solanaAssets: SolanaAsset[];
  totalValueUsd: number;
  timestamp: number;
  evmAddress?: string;
  solanaAddress?: string;
}

// Wallet-scoped preloaded cache: key = evmAddress:solanaAddress
let preloadedCacheMap: Map<string, PortfolioDisplayCache> = new Map();
let currentCacheKey: string | null = null;

// Helper to build a unique cache key for a wallet
function buildCacheKey(evmAddress?: string, solanaAddress?: string): string {
  return `${evmAddress || ""}:${solanaAddress || ""}`;
}

export function getPreloadedCache(): PortfolioDisplayCache | null {
  if (!currentCacheKey) return null;
  return preloadedCacheMap.get(currentCacheKey) || null;
}

export function getDefaultNativeTokens(): { solana: SolanaAsset[]; evm: MultiChainAsset[] } {
  const solanaDefault: SolanaAsset[] = [
    {
      symbol: "SOL",
      name: "Solana",
      balance: "0.00",
      rawBalance: BigInt(0),
      decimals: 9,
      isNative: true,
      chainId: "solana",
      chainName: "Solana",
      priceUsd: 0,
      valueUsd: 0,
    },
  ];

  const evmDefaults: MultiChainAsset[] = [
    {
      symbol: "ETH",
      name: "Ethereum",
      balance: "0.00",
      rawBalance: BigInt(0),
      decimals: 18,
      isNative: true,
      chainId: 1,
      chainName: "Ethereum",
      priceUsd: 0,
      valueUsd: 0,
    },
    {
      symbol: "POL",
      name: "Polygon",
      balance: "0.00",
      rawBalance: BigInt(0),
      decimals: 18,
      isNative: true,
      chainId: 137,
      chainName: "Polygon",
      priceUsd: 0,
      valueUsd: 0,
    },
    {
      symbol: "BNB",
      name: "BNB Chain",
      balance: "0.00",
      rawBalance: BigInt(0),
      decimals: 18,
      isNative: true,
      chainId: 56,
      chainName: "BNB Chain",
      priceUsd: 0,
      valueUsd: 0,
    },
  ];

  return { solana: solanaDefault, evm: evmDefaults };
}

export function clearPreloadedCache(): void {
  // Clear current wallet's cache from memory
  if (currentCacheKey) {
    preloadedCacheMap.delete(currentCacheKey);
  }
  currentCacheKey = null;
}

// Invalidate all cached data for a specific wallet
export function invalidateWalletCache(evmAddress?: string, solanaAddress?: string): void {
  const key = buildCacheKey(evmAddress, solanaAddress);
  preloadedCacheMap.delete(key);
  if (currentCacheKey === key) {
    currentCacheKey = null;
  }
  console.log(`[PortfolioCache] Invalidated cache for wallet: ${key}`);
}

// Invalidate all wallet caches (use when switching wallets)
export function invalidateAllCaches(): void {
  preloadedCacheMap.clear();
  currentCacheKey = null;
  console.log("[PortfolioCache] Invalidated all wallet caches");
}

// Reset in-memory portfolio cache (called on wallet switch/add)
export function resetPortfolioCache(): void {
  preloadedCacheMap.clear();
  currentCacheKey = null;
  console.log("[PortfolioCache] Reset in-memory portfolio cache");
}

export async function prefetchPortfolioCache(
  evmAddress?: string,
  solanaAddress?: string
): Promise<PortfolioDisplayCache | null> {
  try {
    // Build wallet-scoped cache key
    const walletKey = buildCacheKey(evmAddress, solanaAddress);
    currentCacheKey = walletKey;
    const displayCacheStorageKey = `${DISPLAY_CACHE_KEY_PREFIX}${walletKey}`;
    
    const displayCacheStr = await AsyncStorage.getItem(displayCacheStorageKey);
    
    if (displayCacheStr) {
      const displayCache: PortfolioDisplayCache = JSON.parse(displayCacheStr);
      
      // Verify addresses match (extra safety)
      const addressMatch = 
        (!evmAddress || displayCache.evmAddress === evmAddress) &&
        (!solanaAddress || displayCache.solanaAddress === solanaAddress);
      
      if (addressMatch && Date.now() - displayCache.timestamp < INSTANT_CACHE_DURATION) {
        displayCache.evmAssets = displayCache.evmAssets.map((a: any) => ({
          ...a,
          rawBalance: BigInt(a.rawBalance || "0"),
        }));
        displayCache.solanaAssets = displayCache.solanaAssets.map((a: any) => ({
          ...a,
          rawBalance: BigInt(a.rawBalance || "0"),
        }));
        
        // Store in wallet-scoped memory cache
        preloadedCacheMap.set(walletKey, displayCache);
        console.log("[PortfolioCache] Loaded display cache for wallet:", walletKey,
          "with", displayCache.evmAssets.length, "EVM assets and",
          displayCache.solanaAssets.length, "Solana assets"
        );
        return displayCache;
      }
    }

    let evmAssets: MultiChainAsset[] = [];
    let solanaAssets: SolanaAsset[] = [];

    if (evmAddress) {
      const evmCacheStr = await AsyncStorage.getItem(`${PORTFOLIO_CACHE_KEY}${evmAddress}`);
      if (evmCacheStr) {
        const evmCache = JSON.parse(evmCacheStr);
        evmAssets = evmCache.assets.map((a: any) => ({
          ...a,
          rawBalance: BigInt(a.rawBalance || "0"),
        }));
      }
    }

    if (solanaAddress) {
      const solanaCacheStr = await AsyncStorage.getItem(`${SOLANA_CACHE_KEY}${solanaAddress}`);
      if (solanaCacheStr) {
        const solanaCache = JSON.parse(solanaCacheStr);
        solanaAssets = solanaCache.assets.map((a: any) => ({
          ...a,
          rawBalance: BigInt(a.rawBalance || "0"),
        }));
      }
    }

    if (evmAssets.length > 0 || solanaAssets.length > 0) {
      const totalValueUsd = [
        ...evmAssets.map(a => a.valueUsd || 0),
        ...solanaAssets.map(a => a.valueUsd || 0),
      ].reduce((sum, val) => sum + val, 0);

      const cache: PortfolioDisplayCache = {
        evmAssets,
        solanaAssets,
        totalValueUsd,
        timestamp: Date.now(),
        evmAddress,
        solanaAddress,
      };
      
      // Store in wallet-scoped memory cache
      preloadedCacheMap.set(walletKey, cache);

      console.log("[PortfolioCache] Built cache from individual caches for wallet:", walletKey);
      return cache;
    }

    console.log("[PortfolioCache] No cached data found for wallet:", walletKey);
    return null;
  } catch (error) {
    console.warn("[PortfolioCache] Failed to prefetch:", error);
    return null;
  }
}

export async function savePortfolioDisplayCache(
  evmAssets: MultiChainAsset[],
  solanaAssets: SolanaAsset[],
  evmAddress?: string,
  solanaAddress?: string
): Promise<void> {
  try {
    // Build wallet-scoped cache key
    const walletKey = buildCacheKey(evmAddress, solanaAddress);
    const displayCacheStorageKey = `${DISPLAY_CACHE_KEY_PREFIX}${walletKey}`;
    
    const totalValueUsd = [
      ...evmAssets.map(a => a.valueUsd || 0),
      ...solanaAssets.map(a => a.valueUsd || 0),
    ].reduce((sum, val) => sum + val, 0);

    const cache: PortfolioDisplayCache = {
      evmAssets: evmAssets.map(a => ({
        ...a,
        rawBalance: a.rawBalance.toString() as unknown as bigint,
      })),
      solanaAssets: solanaAssets.map(a => ({
        ...a,
        rawBalance: a.rawBalance.toString() as unknown as bigint,
      })),
      totalValueUsd,
      timestamp: Date.now(),
      evmAddress,
      solanaAddress,
    };

    await AsyncStorage.setItem(displayCacheStorageKey, JSON.stringify(cache));
    console.log("[PortfolioCache] Saved display cache for wallet:", walletKey);
  } catch (error) {
    console.warn("[PortfolioCache] Failed to save display cache:", error);
  }
}
