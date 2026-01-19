import { DexMarketData } from "@/types/tokenSafety";

const DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens";
const FETCH_TIMEOUT_MS = 5000;

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string;
  liquidity?: { usd: number };
  volume?: { h24: number };
  fdv?: number;
  marketCap?: number;
  priceChange?: { h24: number };
}

interface DexScreenerResponse {
  pairs?: DexScreenerPair[];
}

export async function fetchDexMarketData(mint: string): Promise<DexMarketData | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${DEXSCREENER_API}/${mint}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data: DexScreenerResponse = await response.json();
    if (!data.pairs || data.pairs.length === 0) {
      return null;
    }

    const solanaPairs = data.pairs.filter((p) => p.chainId === "solana");
    if (solanaPairs.length === 0) {
      return null;
    }

    const bestPair = solanaPairs.reduce((best, current) => {
      const bestLiq = best.liquidity?.usd ?? 0;
      const currentLiq = current.liquidity?.usd ?? 0;
      return currentLiq > bestLiq ? current : best;
    }, solanaPairs[0]);

    return {
      pairAddress: bestPair.pairAddress,
      dexId: bestPair.dexId,
      url: bestPair.url,
      liquidityUsd: bestPair.liquidity?.usd ?? 0,
      volume24hUsd: bestPair.volume?.h24 ?? 0,
      fdvUsd: bestPair.fdv,
      marketCapUsd: bestPair.marketCap,
      priceUsd: parseFloat(bestPair.priceUsd) || undefined,
      priceChange24h: bestPair.priceChange?.h24,
      baseToken: {
        address: bestPair.baseToken.address,
        symbol: bestPair.baseToken.symbol,
      },
      quoteToken: {
        address: bestPair.quoteToken.address,
        symbol: bestPair.quoteToken.symbol,
      },
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (__DEV__) {
      console.log("[DexMarketData] Fetch failed:", err);
    }
    return null;
  }
}
