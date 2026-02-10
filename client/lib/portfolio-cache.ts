import AsyncStorage from "@react-native-async-storage/async-storage";
import { SolanaAsset } from "@/hooks/useSolanaPortfolio";

const SOLANA_CACHE_KEY = "@cordon/solana_portfolio_v2_";
// Display cache is now wallet-scoped: @cordon/portfolio_display_cache_{solAddr}
const DISPLAY_CACHE_KEY_PREFIX = "@cordon/portfolio_display_cache_";
const INSTANT_CACHE_DURATION = 300000;

export interface PortfolioDisplayCache {
  solanaAssets: SolanaAsset[];
  totalValueUsd: number;
  timestamp: number;
  solanaAddress?: string;
}

// Wallet-scoped preloaded cache: key = solanaAddress
let preloadedCacheMap: Map<string, PortfolioDisplayCache> = new Map();
let currentCacheKey: string | null = null;

// Helper to build a unique cache key for a wallet
function buildCacheKey(solanaAddress?: string): string {
  return solanaAddress || "";
}

export function getPreloadedCache(): PortfolioDisplayCache | null {
  if (!currentCacheKey) return null;
  return preloadedCacheMap.get(currentCacheKey) || null;
}

export function getDefaultNativeTokens(): { solana: SolanaAsset[] } {
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

  return { solana: solanaDefault };
}

export function clearPreloadedCache(): void {
  // Clear current wallet's cache from memory
  if (currentCacheKey) {
    preloadedCacheMap.delete(currentCacheKey);
  }
  currentCacheKey = null;
}

// Invalidate all cached data for a specific wallet
export function invalidateWalletCache(solanaAddress?: string): void {
  const key = buildCacheKey(solanaAddress);
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
  solanaAddress?: string
): Promise<PortfolioDisplayCache | null> {
  try {
    // Build wallet-scoped cache key
    const walletKey = buildCacheKey(solanaAddress);
    currentCacheKey = walletKey;
    const displayCacheStorageKey = `${DISPLAY_CACHE_KEY_PREFIX}${walletKey}`;

    const displayCacheStr = await AsyncStorage.getItem(displayCacheStorageKey);

    if (displayCacheStr) {
      const displayCache: PortfolioDisplayCache = JSON.parse(displayCacheStr);

      // Verify addresses match (extra safety)
      const addressMatch =
        (!solanaAddress || displayCache.solanaAddress === solanaAddress);

      if (addressMatch && Date.now() - displayCache.timestamp < INSTANT_CACHE_DURATION) {
        displayCache.solanaAssets = displayCache.solanaAssets.map((a: any) => ({
          ...a,
          rawBalance: BigInt(a.rawBalance || "0"),
        }));

        // Store in wallet-scoped memory cache
        preloadedCacheMap.set(walletKey, displayCache);
        console.log("[PortfolioCache] Loaded display cache for wallet:", walletKey,
          "with", displayCache.solanaAssets.length, "Solana assets"
        );
        return displayCache;
      }
    }

    let solanaAssets: SolanaAsset[] = [];

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

    if (solanaAssets.length > 0) {
      const totalValueUsd = solanaAssets
        .map(a => a.valueUsd || 0)
        .reduce((sum, val) => sum + val, 0);

      const cache: PortfolioDisplayCache = {
        solanaAssets,
        totalValueUsd,
        timestamp: Date.now(),
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
  solanaAssets: SolanaAsset[],
  solanaAddress?: string
): Promise<void> {
  try {
    // Build wallet-scoped cache key
    const walletKey = buildCacheKey(solanaAddress);
    const displayCacheStorageKey = `${DISPLAY_CACHE_KEY_PREFIX}${walletKey}`;

    const totalValueUsd = solanaAssets
      .map(a => a.valueUsd || 0)
      .reduce((sum, val) => sum + val, 0);

    const cache: PortfolioDisplayCache = {
      solanaAssets: solanaAssets.map(a => ({
        ...a,
        rawBalance: a.rawBalance.toString() as unknown as bigint,
      })),
      totalValueUsd,
      timestamp: Date.now(),
      solanaAddress,
    };

    await AsyncStorage.setItem(displayCacheStorageKey, JSON.stringify(cache));
    console.log("[PortfolioCache] Saved display cache for wallet:", walletKey);
  } catch (error) {
    console.warn("[PortfolioCache] Failed to save display cache:", error);
  }
}
