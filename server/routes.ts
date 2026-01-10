import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";

const ETHERSCAN_V2_API = "https://api.etherscan.io/v2/api";
const COINGECKO_API = "https://api.coingecko.com/api/v3";

const NATIVE_TOKEN_IDS: Record<number, string> = {
  1: "ethereum",
  137: "matic-network",
  56: "binancecoin",
};

const EXTRA_TOKEN_IDS = ["bitcoin"];

const CHAIN_PLATFORM_IDS: Record<number, string> = {
  1: "ethereum",
  137: "polygon-pos",
  56: "binance-smart-chain",
};

interface PriceCache {
  data: Record<string, number>;
  timestamp: number;
}

let priceCache: PriceCache = { data: {}, timestamp: 0 };
const PRICE_CACHE_DURATION = 60000;

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
      const url = `${COINGECKO_API}/simple/price?ids=${allIds}&vs_currencies=usd`;
      
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
      
      const prices: Record<string, number> = {};
      
      for (const [chainId, geckoId] of Object.entries(NATIVE_TOKEN_IDS)) {
        if (data[geckoId]?.usd) {
          prices[`native_${chainId}`] = data[geckoId].usd;
        }
      }

      prices["USDC"] = 1.0;
      prices["USDT"] = 1.0;
      prices["DAI"] = 1.0;

      if (data["ethereum"]?.usd) {
        prices["WETH"] = data["ethereum"].usd;
        prices["ETH"] = data["ethereum"].usd;
      }
      if (data["bitcoin"]?.usd) {
        prices["WBTC"] = data["bitcoin"].usd;
        prices["BTCB"] = data["bitcoin"].usd;
        prices["BTC"] = data["bitcoin"].usd;
      }
      if (data["matic-network"]?.usd) {
        prices["MATIC"] = data["matic-network"].usd;
        prices["POL"] = data["matic-network"].usd;
      }
      if (data["binancecoin"]?.usd) {
        prices["BNB"] = data["binancecoin"].usd;
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

  const httpServer = createServer(app);

  return httpServer;
}
