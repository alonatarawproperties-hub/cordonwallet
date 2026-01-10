import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";

const ETHERSCAN_V2_API = "https://api.etherscan.io/v2/api";
const COINGECKO_API = "https://api.coingecko.com/api/v3";
const DEXSCREENER_API = "https://api.dexscreener.com";

const DEXSCREENER_CHAIN_IDS: Record<number, string> = {
  1: "ethereum",
  137: "polygon",
  56: "bsc",
};

const NATIVE_TOKEN_IDS: Record<number, string> = {
  1: "ethereum",
  137: "polygon-ecosystem-token",
  56: "binancecoin",
};

const EXTRA_TOKEN_IDS = ["bitcoin"];

const CHAIN_PLATFORM_IDS: Record<number, string> = {
  1: "ethereum",
  137: "polygon-pos",
  56: "binance-smart-chain",
};

interface PriceData {
  price: number;
  change24h?: number;
}

interface PriceCache {
  data: Record<string, PriceData>;
  timestamp: number;
}

interface HistoricalPriceCache {
  [key: string]: { price: number; timestamp: number };
}

let priceCache: PriceCache = { data: {}, timestamp: 0 };
const PRICE_CACHE_DURATION = 60000;

let historicalPriceCache: HistoricalPriceCache = {};
const HISTORICAL_CACHE_DURATION = 3600000;

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/transactions/:address", async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const chainId = req.query.chainId as string;
      
      if (!address || !chainId) {
        return res.status(400).json({ error: "Missing address or chainId" });
      }

      const apiKey = process.env.ETHERSCAN_API_KEY;
      console.log(`[Transactions API] API key configured: ${!!apiKey}`);
      
      const params = new URLSearchParams({
        chainid: chainId,
        module: "account",
        action: "txlist",
        address: address,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: "50",
        sort: "desc",
      });
      
      if (apiKey) {
        params.append("apikey", apiKey);
      }

      const url = `${ETHERSCAN_V2_API}?${params.toString()}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      res.json(data);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  app.get("/api/prices", async (req: Request, res: Response) => {
    try {
      const now = Date.now();
      
      if (now - priceCache.timestamp < PRICE_CACHE_DURATION && Object.keys(priceCache.data).length > 0) {
        console.log("[Prices API] Returning cached prices");
        return res.json({ prices: priceCache.data, cached: true });
      }

      console.log("[Prices API] Fetching fresh prices from CoinGecko");

      const allIds = [...Object.values(NATIVE_TOKEN_IDS), ...EXTRA_TOKEN_IDS].join(",");
      const url = `${COINGECKO_API}/simple/price?ids=${allIds}&vs_currencies=usd&include_24hr_change=true`;
      
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        console.error("[Prices API] CoinGecko error:", response.status);
        if (Object.keys(priceCache.data).length > 0) {
          return res.json({ prices: priceCache.data, cached: true, stale: true });
        }
        return res.status(502).json({ error: "Failed to fetch prices from upstream" });
      }

      const data = await response.json();
      
      const prices: Record<string, PriceData> = {};
      
      for (const [chainId, geckoId] of Object.entries(NATIVE_TOKEN_IDS)) {
        if (data[geckoId]?.usd) {
          prices[`native_${chainId}`] = {
            price: data[geckoId].usd,
            change24h: data[geckoId].usd_24h_change,
          };
        }
      }

      prices["USDC"] = { price: 1.0, change24h: 0 };
      prices["USDT"] = { price: 1.0, change24h: 0 };
      prices["DAI"] = { price: 1.0, change24h: 0 };

      if (data["ethereum"]?.usd) {
        const ethData = { price: data["ethereum"].usd, change24h: data["ethereum"].usd_24h_change };
        prices["WETH"] = ethData;
        prices["ETH"] = ethData;
      }
      if (data["bitcoin"]?.usd) {
        const btcData = { price: data["bitcoin"].usd, change24h: data["bitcoin"].usd_24h_change };
        prices["WBTC"] = btcData;
        prices["BTCB"] = btcData;
        prices["BTC"] = btcData;
      }
      if (data["polygon-ecosystem-token"]?.usd) {
        const maticData = { price: data["polygon-ecosystem-token"].usd, change24h: data["polygon-ecosystem-token"].usd_24h_change };
        prices["MATIC"] = maticData;
        prices["POL"] = maticData;
      }
      if (data["binancecoin"]?.usd) {
        prices["BNB"] = { price: data["binancecoin"].usd, change24h: data["binancecoin"].usd_24h_change };
      }

      priceCache = { data: prices, timestamp: now };
      
      console.log("[Prices API] Fetched prices:", Object.keys(prices).length);
      res.json({ prices, cached: false });
    } catch (error) {
      console.error("[Prices API] Error:", error);
      if (Object.keys(priceCache.data).length > 0) {
        return res.json({ prices: priceCache.data, cached: true, stale: true });
      }
      res.status(500).json({ error: "Failed to fetch prices" });
    }
  });

  app.get("/api/historical-price/:geckoId/:timestamp", async (req: Request, res: Response) => {
    try {
      const { geckoId, timestamp } = req.params;
      const ts = parseInt(timestamp);
      
      if (!geckoId || isNaN(ts)) {
        return res.status(400).json({ error: "Missing geckoId or invalid timestamp" });
      }

      const cacheKey = `${geckoId}_${Math.floor(ts / 86400000)}`;
      const cached = historicalPriceCache[cacheKey];
      const now = Date.now();
      
      if (cached && now - cached.timestamp < HISTORICAL_CACHE_DURATION) {
        return res.json({ price: cached.price, cached: true });
      }

      const date = new Date(ts);
      const dateStr = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
      
      console.log(`[Historical Price] Fetching ${geckoId} for ${dateStr}`);
      
      const url = `${COINGECKO_API}/coins/${geckoId}/history?date=${dateStr}&localization=false`;
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
      });

      if (!response.ok) {
        console.error("[Historical Price] CoinGecko error:", response.status);
        return res.status(502).json({ error: "Failed to fetch historical price" });
      }

      const data = await response.json();
      const price = data?.market_data?.current_price?.usd || 0;
      
      historicalPriceCache[cacheKey] = { price, timestamp: now };
      
      res.json({ price, cached: false });
    } catch (error) {
      console.error("[Historical Price] Error:", error);
      res.status(500).json({ error: "Failed to fetch historical price" });
    }
  });

  app.post("/api/enrich-transactions", async (req: Request, res: Response) => {
    try {
      const { transactions } = req.body;
      
      if (!Array.isArray(transactions)) {
        return res.status(400).json({ error: "transactions must be an array" });
      }

      const enriched = await Promise.all(transactions.map(async (tx: any) => {
        if (tx.priceUsd) return tx;
        
        const geckoId = NATIVE_TOKEN_IDS[tx.chainId];
        if (!geckoId) return tx;
        
        const cacheKey = `${geckoId}_${Math.floor(tx.createdAt / 86400000)}`;
        const cached = historicalPriceCache[cacheKey];
        const now = Date.now();
        
        if (cached && now - cached.timestamp < HISTORICAL_CACHE_DURATION) {
          return { ...tx, priceUsd: cached.price };
        }
        
        try {
          const date = new Date(tx.createdAt);
          const dateStr = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
          
          const url = `${COINGECKO_API}/coins/${geckoId}/history?date=${dateStr}&localization=false`;
          const response = await fetch(url, {
            headers: { "Accept": "application/json" },
          });
          
          if (response.ok) {
            const data = await response.json();
            const price = data?.market_data?.current_price?.usd || 0;
            historicalPriceCache[cacheKey] = { price, timestamp: now };
            return { ...tx, priceUsd: price };
          }
        } catch (e) {
          console.error("[Enrich] Failed to get historical price for tx:", tx.hash);
        }
        
        return tx;
      }));
      
      res.json({ transactions: enriched });
    } catch (error) {
      console.error("[Enrich Transactions] Error:", error);
      res.status(500).json({ error: "Failed to enrich transactions" });
    }
  });

  // DexScreener fallback for tokens not on CoinGecko (e.g., pump.fun tokens)
  app.get("/api/dexscreener/token/:chainId/:address", async (req: Request, res: Response) => {
    try {
      const { chainId, address } = req.params;
      
      if (!chainId || !address) {
        return res.status(400).json({ error: "Missing chainId or address" });
      }

      const dexChainId = DEXSCREENER_CHAIN_IDS[Number(chainId)];
      if (!dexChainId) {
        return res.status(400).json({ error: "Unsupported chain" });
      }

      console.log(`[DexScreener API] Fetching price for ${address} on ${dexChainId}`);

      const url = `${DEXSCREENER_API}/token-pairs/v1/${dexChainId}/${address}`;
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
      });

      if (!response.ok) {
        console.error("[DexScreener API] Error:", response.status);
        return res.status(502).json({ error: "Failed to fetch from DexScreener" });
      }

      const data = await response.json();
      
      // Get the pair with highest liquidity
      const pairs = data.pairs || data || [];
      if (!Array.isArray(pairs) || pairs.length === 0) {
        return res.json({ price: null, pairs: [] });
      }

      // Sort by liquidity (USD) descending
      const sortedPairs = [...pairs].sort((a: any, b: any) => {
        const liqA = a.liquidity?.usd || 0;
        const liqB = b.liquidity?.usd || 0;
        return liqB - liqA;
      });

      const bestPair = sortedPairs[0];
      const priceUsd = bestPair.priceUsd ? parseFloat(bestPair.priceUsd) : null;

      res.json({
        price: priceUsd,
        symbol: bestPair.baseToken?.symbol,
        name: bestPair.baseToken?.name,
        liquidity: bestPair.liquidity?.usd,
        volume24h: bestPair.volume?.h24,
        priceChange24h: bestPair.priceChange?.h24,
        dexId: bestPair.dexId,
        pairAddress: bestPair.pairAddress,
        pairCount: pairs.length,
      });
    } catch (error) {
      console.error("[DexScreener API] Error:", error);
      res.status(500).json({ error: "Failed to fetch token price" });
    }
  });

  // Token info endpoint for About tab
  app.get("/api/token-info/:symbol", async (req: Request, res: Response) => {
    try {
      const { symbol } = req.params;
      
      const tokenInfo: Record<string, any> = {
        ETH: {
          description: "Ethereum is a decentralized blockchain platform that enables smart contracts and decentralized applications (dApps). It is the second-largest cryptocurrency by market capitalization.",
          marketCap: 372637000000,
          circulatingSupply: 120694733,
          totalSupply: 120694733,
          website: "https://ethereum.org",
          twitter: "https://twitter.com/ethereum",
        },
        POL: {
          description: "POL (formerly MATIC) is the native token of Polygon, a Layer 2 scaling solution for Ethereum that provides faster and cheaper transactions while maintaining security through the Ethereum mainnet.",
          marketCap: 1580000000,
          circulatingSupply: 10000000000,
          totalSupply: 10000000000,
          website: "https://polygon.technology",
          twitter: "https://twitter.com/0xPolygon",
        },
        BNB: {
          description: "BNB is the native cryptocurrency of the BNB Chain ecosystem, used for transaction fees, staking, and participating in token sales on the Binance Launchpad.",
          marketCap: 95200000000,
          circulatingSupply: 145934632,
          totalSupply: 145934632,
          website: "https://www.bnbchain.org",
          twitter: "https://twitter.com/BNBCHAIN",
        },
        USDC: {
          description: "USD Coin (USDC) is a stablecoin pegged 1:1 to the US Dollar, backed by fully reserved assets and regularly audited to ensure transparency. It is issued by Circle.",
          marketCap: 52800000000,
          circulatingSupply: 52800000000,
          totalSupply: 52800000000,
          website: "https://www.circle.com/usdc",
          twitter: "https://twitter.com/circle",
        },
        USDT: {
          description: "Tether (USDT) is the world's largest stablecoin by market cap, designed to maintain a stable value equivalent to the US Dollar.",
          marketCap: 139400000000,
          circulatingSupply: 139400000000,
          totalSupply: 139400000000,
          website: "https://tether.to",
          twitter: "https://twitter.com/Tether_to",
        },
        DAI: {
          description: "DAI is a decentralized stablecoin soft-pegged to the US Dollar, created and maintained by the MakerDAO protocol through a system of smart contracts.",
          marketCap: 5300000000,
          circulatingSupply: 5300000000,
          totalSupply: 5300000000,
          website: "https://makerdao.com",
          twitter: "https://twitter.com/MakerDAO",
        },
        WBTC: {
          description: "Wrapped Bitcoin (WBTC) is an ERC-20 token backed 1:1 by Bitcoin, allowing BTC to be used in Ethereum's DeFi ecosystem.",
          marketCap: 13500000000,
          circulatingSupply: 148000,
          totalSupply: 148000,
          website: "https://wbtc.network",
          twitter: "https://twitter.com/WrappedBTC",
        },
      };

      const info = tokenInfo[symbol.toUpperCase()];
      if (info) {
        res.json(info);
      } else {
        res.json({ description: null, marketCap: null, circulatingSupply: null, totalSupply: null });
      }
    } catch (error) {
      console.error("[Token Info API] Error:", error);
      res.status(500).json({ error: "Failed to fetch token info" });
    }
  });

  // Batch DexScreener lookup for multiple tokens
  app.post("/api/dexscreener/tokens", async (req: Request, res: Response) => {
    try {
      const { tokens } = req.body;
      
      if (!Array.isArray(tokens) || tokens.length === 0) {
        return res.status(400).json({ error: "tokens array required" });
      }

      // Limit to 30 tokens (DexScreener limit)
      const limitedTokens = tokens.slice(0, 30);
      
      // Group by chain for efficient API calls
      const byChain: Record<string, string[]> = {};
      for (const token of limitedTokens) {
        const { chainId, address } = token;
        const dexChainId = DEXSCREENER_CHAIN_IDS[Number(chainId)];
        if (dexChainId && address) {
          if (!byChain[dexChainId]) byChain[dexChainId] = [];
          byChain[dexChainId].push(address);
        }
      }

      const results: Record<string, any> = {};

      // Fetch prices for each chain
      for (const [dexChainId, addresses] of Object.entries(byChain)) {
        try {
          // DexScreener allows up to 30 addresses comma-separated
          const url = `${DEXSCREENER_API}/latest/dex/tokens/${addresses.join(",")}`;
          console.log(`[DexScreener API] Batch fetch for ${addresses.length} tokens on ${dexChainId}`);
          
          const response = await fetch(url, {
            headers: { "Accept": "application/json" },
          });

          if (response.ok) {
            const data = await response.json();
            const pairs = data.pairs || [];
            
            // Group pairs by base token address
            for (const pair of pairs) {
              if (pair.chainId !== dexChainId) continue;
              
              const tokenAddr = pair.baseToken?.address?.toLowerCase();
              if (!tokenAddr) continue;
              
              const key = `${dexChainId}_${tokenAddr}`;
              
              // Keep the pair with highest liquidity
              if (!results[key] || (pair.liquidity?.usd || 0) > (results[key].liquidity || 0)) {
                results[key] = {
                  price: pair.priceUsd ? parseFloat(pair.priceUsd) : null,
                  symbol: pair.baseToken?.symbol,
                  name: pair.baseToken?.name,
                  liquidity: pair.liquidity?.usd,
                  address: tokenAddr,
                  chainId: dexChainId,
                };
              }
            }
          }
        } catch (err) {
          console.error(`[DexScreener API] Error fetching ${dexChainId}:`, err);
        }
      }

      res.json({ tokens: results });
    } catch (error) {
      console.error("[DexScreener API] Batch error:", error);
      res.status(500).json({ error: "Failed to fetch token prices" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
