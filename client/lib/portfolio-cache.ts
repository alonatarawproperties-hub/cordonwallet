import AsyncStorage from "@react-native-async-storage/async-storage";
import { MultiChainAsset } from "@/hooks/useAllChainsPortfolio";
import { SolanaAsset } from "@/hooks/useSolanaPortfolio";

const PORTFOLIO_CACHE_KEY = "@cordon/all_chains_portfolio_v2_";
const SOLANA_CACHE_KEY = "@cordon/solana_portfolio_v2_";
const DISPLAY_CACHE_KEY = "@cordon/portfolio_display_cache";
const INSTANT_CACHE_DURATION = 300000;

export interface PortfolioDisplayCache {
  evmAssets: MultiChainAsset[];
  solanaAssets: SolanaAsset[];
  totalValueUsd: number;
  timestamp: number;
  evmAddress?: string;
  solanaAddress?: string;
}

let preloadedCache: PortfolioDisplayCache | null = null;

export function getPreloadedCache(): PortfolioDisplayCache | null {
  return preloadedCache;
}

export function clearPreloadedCache(): void {
  preloadedCache = null;
}

export async function prefetchPortfolioCache(
  evmAddress?: string,
  solanaAddress?: string
): Promise<PortfolioDisplayCache | null> {
  try {
    const displayCacheStr = await AsyncStorage.getItem(DISPLAY_CACHE_KEY);
    
    if (displayCacheStr) {
      const displayCache: PortfolioDisplayCache = JSON.parse(displayCacheStr);
      
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
        
        preloadedCache = displayCache;
        console.log("[PortfolioCache] Loaded display cache with", 
          displayCache.evmAssets.length, "EVM assets and",
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

      preloadedCache = {
        evmAssets,
        solanaAssets,
        totalValueUsd,
        timestamp: Date.now(),
        evmAddress,
        solanaAddress,
      };

      console.log("[PortfolioCache] Built cache from individual caches");
      return preloadedCache;
    }

    console.log("[PortfolioCache] No cached data found");
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

    await AsyncStorage.setItem(DISPLAY_CACHE_KEY, JSON.stringify(cache));
    console.log("[PortfolioCache] Saved display cache");
  } catch (error) {
    console.warn("[PortfolioCache] Failed to save display cache:", error);
  }
}
