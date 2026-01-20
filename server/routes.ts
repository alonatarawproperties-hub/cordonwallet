import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import {
  getSolanaPortfolio,
  getSolanaBalance,
  prepareSolTransfer,
  prepareSplTransfer,
  sendSignedTransaction,
  checkAtaExists,
  getSplTokenMetadata,
  getSolanaTransactionHistory,
  estimateSolanaFee,
  getSolanaConnection,
} from "./solana-api";
import { validateSwapTxServer, type SwapSecurityResult } from "./swap/txSecurity";
import { quoteRateLimiter, tokenListRateLimiter, swapBuildRateLimiter } from "./middleware/rateLimit";
import { fetchWithBackoff } from "./lib/fetchWithBackoff";

const ETHERSCAN_V2_API = "https://api.etherscan.io/v2/api";
const COINGECKO_API = "https://api.coingecko.com/api/v3";
const DEXSCREENER_API = "https://api.dexscreener.com";
const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2";
// Jupiter Lite API - must match server/swap/config.ts for quote/swap consistency
const JUPITER_API = "https://lite-api.jup.ag/swap/v1";
const JUPITER_TOKENS_API = "https://tokens.jup.ag";

// SOL/WSOL mint address - Jupiter represents native SOL as WSOL
const WSOL_MINT = "So11111111111111111111111111111111111111112";

// Helper: Normalize swap params for SOL/WSOL output
// - For SOL output: wrapAndUnwrapSol=true, NO destination token account, NO platform fees
// - For non-SOL output: normal behavior
function normalizeJupiterSwapParams(
  body: Record<string, any>,
  quoteResponse: any
): { normalizedBody: Record<string, any>; isSolOutput: boolean; debug: Record<string, any> } {
  const outputMint = quoteResponse?.outputMint || "";
  const isSolOutput = outputMint === WSOL_MINT;
  
  // Fields to NEVER pass for SOL output (or at all for safety)
  const dangerousFields = [
    "destinationTokenAccount",
    "destinationTokenAccountAddress", 
    "outputTokenAccount",
    "outputAccount",
    "feeAccount",
    "platformFeeBps",
    "referralAccount",
    "disablePlatformFee",
  ];
  
  // Create clean body without dangerous fields
  const normalizedBody: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!dangerousFields.includes(key)) {
      normalizedBody[key] = value;
    }
  }
  
  // Force wrapAndUnwrapSol=true for SOL output (critical!)
  if (isSolOutput) {
    normalizedBody.wrapAndUnwrapSol = true;
  }
  
  // IMPORTANT: Do NOT modify the quoteResponse object at all!
  // Jupiter's swap endpoint requires the exact quoteResponse from the quote endpoint.
  // Any modification (even setting platformFee: null) can cause 0x1788 errors.
  
  const debug = {
    outputMint: outputMint.slice(0, 8) + "...",
    isSolOutput,
    hasDestinationTokenAccountField: "destinationTokenAccount" in body || "outputTokenAccount" in body,
    wrapAndUnwrapSol: normalizedBody.wrapAndUnwrapSol,
    hasPlatformFeeFields: "feeAccount" in body || "platformFeeBps" in body,
    strippedFields: dangerousFields.filter(f => f in body),
  };
  
  return { normalizedBody, isSolOutput, debug };
}

const DEXSCREENER_CHAIN_IDS: Record<number | string, string> = {
  0: "solana",
  1: "ethereum",
  137: "polygon",
  56: "bsc",
  42161: "arbitrum",
  "solana": "solana",
};

const NATIVE_TOKEN_IDS: Record<number | string, string> = {
  1: "ethereum",
  137: "polygon-ecosystem-token",
  56: "binancecoin",
  42161: "ethereum",
  "solana": "solana",
};

const EXTRA_TOKEN_IDS = ["bitcoin", "arbitrum"];

const CHAIN_PLATFORM_IDS: Record<number, string> = {
  1: "ethereum",
  137: "polygon-pos",
  56: "binance-smart-chain",
  42161: "arbitrum-one",
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
  [key: string]: { price: number | [number, number][]; timestamp: number; source?: string; isReal?: boolean };
}

let priceCache: PriceCache = { data: {}, timestamp: 0 };
const PRICE_CACHE_DURATION = 60000;

let historicalPriceCache: HistoricalPriceCache = {};
const HISTORICAL_CACHE_DURATION = 3600000;

export async function registerRoutes(app: Express): Promise<Server> {
  // Health check endpoint for Solana RPC - used by mobile app to verify connectivity
  app.get("/api/solana/health", async (req: Request, res: Response) => {
    try {
      const balance = await getSolanaBalance("So11111111111111111111111111111111111111112"); // Wrapped SOL mint
      res.json({ ok: true, timestamp: Date.now() });
    } catch (error: any) {
      console.error("[Health] Solana RPC check failed:", error.message);
      res.status(503).json({ ok: false, error: "Solana RPC unavailable" });
    }
  });

  // Jupiter API Proxy - Quote endpoint (public API, no auth required)
  // NOTE: platformFeeBps is NEVER sent to Jupiter - platform fees are disabled
  app.get("/api/jupiter/quote", quoteRateLimiter, async (req: Request, res: Response) => {
    try {
      const { inputMint, outputMint, amount, slippageBps, swapMode, onlyDirectRoutes } = req.query;
      
      if (!inputMint || !outputMint || !amount) {
        return res.status(400).json({ error: "Missing required parameters: inputMint, outputMint, amount" });
      }

      // NEVER include platformFeeBps - platform fees are disabled
      const params = new URLSearchParams({
        inputMint: inputMint as string,
        outputMint: outputMint as string,
        amount: amount as string,
        slippageBps: (slippageBps as string) || "50",
        swapMode: (swapMode as string) || "ExactIn",
      });
      
      if (onlyDirectRoutes === "true") {
        params.set("onlyDirectRoutes", "true");
      }

      const url = `${JUPITER_API}/quote?${params.toString()}`;
      console.log("[Jupiter Proxy] Quote request (NO platformFeeBps):", url);
      
      const response = await fetch(url, {
        headers: { 
          "Accept": "application/json",
          "User-Agent": "Cordon-Wallet/1.0",
        },
      });
      
      const responseText = await response.text();
      console.log("[Jupiter Proxy] Quote response status:", response.status);
      
      if (!response.ok) {
        console.error("[Jupiter Proxy] Quote error:", response.status, responseText);
        return res.status(response.status).json({ error: responseText });
      }
      
      try {
        const data = JSON.parse(responseText);
        // Strip platformFee from response if present
        if (data.platformFee) {
          data.platformFee = null;
          console.log("[Jupiter Proxy] Stripped platformFee from quote response");
        }
        console.log("[SwapFee] quote.platformFee:", data.platformFee ?? null);
        res.json(data);
      } catch {
        console.error("[Jupiter Proxy] Failed to parse response:", responseText);
        res.status(500).json({ error: "Invalid response from Jupiter API" });
      }
    } catch (error: any) {
      console.error("[Jupiter Proxy] Quote failed:", error.message);
      res.status(500).json({ error: error.message || "Failed to fetch quote" });
    }
  });

  // Jupiter API Proxy - Swap endpoint
  // NOTE: Uses normalizeJupiterSwapParams to handle SOL/WSOL output properly
  app.post("/api/jupiter/swap", swapBuildRateLimiter, async (req: Request, res: Response) => {
    try {
      const body = req.body;
      
      if (!body.quoteResponse || !body.userPublicKey) {
        return res.status(400).json({ error: "Missing quoteResponse or userPublicKey" });
      }

      console.log("[Jupiter Proxy] Swap request for:", body.userPublicKey);
      
      // Normalize swap params - handles SOL output special case
      const { normalizedBody, isSolOutput, debug } = normalizeJupiterSwapParams(body, body.quoteResponse);
      
      // Log diagnostic info
      console.log("[JUP_SWAP_DEBUG]", JSON.stringify(debug));
      
      // Additional validation for SOL output
      if (isSolOutput && !normalizedBody.wrapAndUnwrapSol) {
        console.error("[JUP_SWAP_DEBUG] CRITICAL: SOL output but wrapAndUnwrapSol is false!");
        normalizedBody.wrapAndUnwrapSol = true;
      }
      
      const response = await fetch(`${JUPITER_API}/swap`, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(normalizedBody),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Jupiter Proxy] Swap error:", response.status, errorText);
        return res.status(response.status).json({ error: errorText });
      }
      
      const data = await response.json();
      
      // Server-side security validation for LUT transactions
      let security: SwapSecurityResult | undefined;
      if (data.swapTransaction) {
        try {
          const connection = getSolanaConnection();
          security = await validateSwapTxServer({
            txBase64: data.swapTransaction,
            expectedUserPubkey: body.userPublicKey,
            routeType: "jupiter",
            connection,
          });
          console.log("[Jupiter Proxy] Security validation:", security.safe ? "SAFE" : "BLOCKED", security.details.hasLuts ? "(LUT tx)" : "(static tx)");
        } catch (secError: any) {
          console.error("[Jupiter Proxy] Security validation failed:", secError.message);
          security = {
            safe: false,
            warnings: [],
            errors: [`Security validation failed: ${secError.message}`],
            details: {
              feePayer: "",
              feePayerIsUser: false,
              userIsSigner: false,
              programIds: [],
              unknownPrograms: [],
              hasJupiterProgram: false,
              hasPumpProgram: false,
              hasLuts: false,
              addressLookupTables: [],
            },
          };
        }
      }
      
      res.json({ ...data, security });
    } catch (error: any) {
      console.error("[Jupiter Proxy] Swap failed:", error.message);
      res.status(500).json({ error: error.message || "Failed to build swap" });
    }
  });

  // Jupiter Tokens API Proxy with fallbacks
  app.get("/api/jupiter/tokens", tokenListRateLimiter, async (req: Request, res: Response) => {
    const { tags } = req.query;
    
    const endpoints = [
      tags ? `${JUPITER_TOKENS_API}/tokens?tags=${tags}` : `${JUPITER_TOKENS_API}/tokens`,
      "https://token.jup.ag/strict",
      "https://token.jup.ag/all",
    ];
    
    for (const url of endpoints) {
      try {
        console.log("[Jupiter Proxy] Tokens request:", url);
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(url, {
          headers: { "Accept": "application/json" },
          signal: controller.signal,
        });
        
        clearTimeout(timeout);
        
        if (response.ok) {
          const data = await response.json();
          console.log(`[Jupiter Proxy] Tokens fetched: ${Array.isArray(data) ? data.length : 'object'} from ${url}`);
          return res.json(data);
        }
        
        console.warn(`[Jupiter Proxy] Endpoint failed: ${url} - ${response.status}`);
      } catch (error: any) {
        console.warn(`[Jupiter Proxy] Endpoint error: ${url} - ${error.message}`);
      }
    }
    
    console.error("[Jupiter Proxy] All token endpoints failed");
    res.status(503).json({ error: "Token list temporarily unavailable" });
  });

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
      if (data["arbitrum"]?.usd) {
        prices["ARB"] = { price: data["arbitrum"].usd, change24h: data["arbitrum"].usd_24h_change };
      }
      if (data["solana"]?.usd) {
        prices["SOL"] = { price: data["solana"].usd, change24h: data["solana"].usd_24h_change };
        prices["native_solana"] = { price: data["solana"].usd, change24h: data["solana"].usd_24h_change };
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

  // GeckoTerminal OHLCV - provides real historical chart data for DEX tokens
  async function fetchGeckoTerminalOHLCV(network: string, tokenAddress: string, days: string = "7"): Promise<{ prices: [number, number][], isReal: boolean } | null> {
    try {
      // First, find the pool address for this token
      const poolsUrl = `${GECKOTERMINAL_API}/networks/${network}/tokens/${tokenAddress}/pools?page=1`;
      console.log(`[GeckoTerminal] Fetching pools for ${tokenAddress}`);
      
      const poolsResponse = await fetch(poolsUrl, { 
        headers: { "Accept": "application/json" } 
      });
      
      if (!poolsResponse.ok) {
        console.log(`[GeckoTerminal] Pools request failed: ${poolsResponse.status}`);
        return null;
      }
      
      const poolsData = await poolsResponse.json();
      const pools = poolsData?.data || [];
      
      if (pools.length === 0) {
        console.log(`[GeckoTerminal] No pools found for ${tokenAddress}`);
        return null;
      }
      
      // Get the pool with highest liquidity (first one is usually the best)
      const bestPool = pools[0];
      const poolAddress = bestPool?.attributes?.address;
      
      if (!poolAddress) {
        console.log(`[GeckoTerminal] No pool address found`);
        return null;
      }
      
      console.log(`[GeckoTerminal] Found pool: ${poolAddress}`);
      
      // Determine timeframe based on days requested
      let timeframe = "day";
      let aggregate = 1;
      const daysNum = parseInt(days) || 7;
      
      if (daysNum <= 1) {
        timeframe = "minute";
        aggregate = 15; // 15-min candles for 1D
      } else if (daysNum <= 7) {
        timeframe = "hour";
        aggregate = 1; // 1-hour candles for 1W
      } else {
        timeframe = "day";
        aggregate = 1; // Daily candles for longer periods
      }
      
      const ohlcvUrl = `${GECKOTERMINAL_API}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=500`;
      console.log(`[GeckoTerminal] Fetching OHLCV: ${ohlcvUrl}`);
      
      const ohlcvResponse = await fetch(ohlcvUrl, { 
        headers: { "Accept": "application/json" } 
      });
      
      if (!ohlcvResponse.ok) {
        console.log(`[GeckoTerminal] OHLCV request failed: ${ohlcvResponse.status}`);
        return null;
      }
      
      const ohlcvData = await ohlcvResponse.json();
      const candles = ohlcvData?.data?.attributes?.ohlcv_list || [];
      
      if (candles.length === 0) {
        console.log(`[GeckoTerminal] No OHLCV data returned`);
        return null;
      }
      
      // GeckoTerminal returns: [timestamp, open, high, low, close, volume]
      const prices: [number, number][] = candles.map((candle: number[]) => {
        const timestamp = candle[0] * 1000; // Convert to ms
        const closePrice = candle[4]; // Close price
        return [timestamp, closePrice];
      }).reverse(); // GeckoTerminal returns newest first, we want oldest first
      
      console.log(`[GeckoTerminal] Fetched ${prices.length} real OHLCV points`);
      return { prices, isReal: true };
    } catch (error) {
      console.error("[GeckoTerminal] Error:", error);
      return null;
    }
  }

  async function fetchDexScreenerChart(chainId: string, address: string, days: string = "7", symbol?: string): Promise<[number, number][] | null> {
    try {
      const dexChainId = DEXSCREENER_CHAIN_IDS[chainId] || chainId;
      let bestPair: any = null;
      
      const pairsUrl = `${DEXSCREENER_API}/token-pairs/v1/${dexChainId}/${address}`;
      console.log(`[DexScreener Chart] Fetching pairs for ${address} on ${dexChainId}`);
      
      const pairsResponse = await fetch(pairsUrl, { headers: { "Accept": "application/json" } });
      if (pairsResponse.ok) {
        const pairs = await pairsResponse.json();
        if (Array.isArray(pairs) && pairs.length > 0) {
          bestPair = pairs.reduce((best: any, pair: any) => 
            (pair.liquidity?.usd || 0) > (best?.liquidity?.usd || 0) ? pair : best
          , pairs[0]);
        }
      }
      
      if (!bestPair) {
        console.log(`[DexScreener Chart] No pairs found, trying tokens endpoint`);
        const searchUrl = `${DEXSCREENER_API}/latest/dex/tokens/${address}`;
        const searchResponse = await fetch(searchUrl, { headers: { "Accept": "application/json" } });
        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          const searchPairs = searchData?.pairs || [];
          if (Array.isArray(searchPairs) && searchPairs.length > 0) {
            const filteredPairs = searchPairs.filter((p: any) => p.chainId === dexChainId);
            if (filteredPairs.length > 0) {
              bestPair = filteredPairs.reduce((best: any, pair: any) => 
                (pair.liquidity?.usd || 0) > (best?.liquidity?.usd || 0) ? pair : best
              , filteredPairs[0]);
            }
          }
        }
      }
      
      if (!bestPair && symbol) {
        console.log(`[DexScreener Chart] Trying symbol search for "${symbol}" on ${dexChainId}`);
        const symbolSearchUrl = `${DEXSCREENER_API}/latest/dex/search?q=${encodeURIComponent(symbol)}`;
        const symbolSearchResponse = await fetch(symbolSearchUrl, { headers: { "Accept": "application/json" } });
        if (symbolSearchResponse.ok) {
          const symbolSearchData = await symbolSearchResponse.json();
          const searchPairs = symbolSearchData?.pairs || [];
          if (Array.isArray(searchPairs) && searchPairs.length > 0) {
            const filteredPairs = searchPairs.filter((p: any) => 
              p.chainId === dexChainId && 
              p.baseToken?.symbol?.toUpperCase() === symbol.toUpperCase()
            );
            if (filteredPairs.length > 0) {
              bestPair = filteredPairs.reduce((best: any, pair: any) => 
                (pair.liquidity?.usd || 0) > (best?.liquidity?.usd || 0) ? pair : best
              , filteredPairs[0]);
              console.log(`[DexScreener Chart] Found ${symbol} via symbol search at ${bestPair?.pairAddress}`);
            }
          }
        }
      }
      
      if (!bestPair?.pairAddress) return null;
      
      console.log(`[DexScreener Chart] Found pair: ${bestPair.pairAddress} with $${bestPair.liquidity?.usd || 0} liquidity`);
      
      const resolution = days === "1" ? "15" : days === "7" ? "60" : "240";
      const daysNum = parseInt(days) || 7;
      const from = Math.floor((Date.now() - daysNum * 24 * 60 * 60 * 1000) / 1000);
      const to = Math.floor(Date.now() / 1000);
      
      const ohlcvUrl = `https://io.dexscreener.com/dex/chart/amm/v3/${dexChainId}/${bestPair.pairAddress}?res=${resolution}&from=${from}&to=${to}`;
      console.log(`[DexScreener Chart] Fetching OHLCV from ${ohlcvUrl}`);
      
      const ohlcvResponse = await fetch(ohlcvUrl, { 
        headers: { 
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; CordonWallet/1.0)"
        } 
      });
      
      if (ohlcvResponse.ok) {
        const ohlcvData = await ohlcvResponse.json();
        
        if (ohlcvData?.bars && Array.isArray(ohlcvData.bars) && ohlcvData.bars.length > 0) {
          const prices: [number, number][] = ohlcvData.bars.map((bar: any) => {
            const timestamp = bar.timestamp * 1000;
            const closePrice = parseFloat(bar.close);
            return [timestamp, closePrice];
          });
          
          console.log(`[DexScreener Chart] Fetched ${prices.length} real OHLCV points`);
          return prices;
        }
      }
      
      console.log("[DexScreener Chart] OHLCV not available, falling back to synthetic data");
      
      if (!bestPair?.priceUsd) return null;
      
      const currentPrice = parseFloat(bestPair.priceUsd);
      const priceChange24h = parseFloat(bestPair.priceChange?.h24 || "0") / 100;
      const priceChange6h = parseFloat(bestPair.priceChange?.h6 || "0") / 100;
      const priceChange1h = parseFloat(bestPair.priceChange?.h1 || "0") / 100;
      const priceChange5m = parseFloat(bestPair.priceChange?.m5 || "0") / 100;
      
      const now = Date.now();
      const prices: [number, number][] = [];
      
      const volatility = Math.max(
        Math.abs(priceChange24h),
        Math.abs(priceChange6h) * 2,
        Math.abs(priceChange1h) * 4
      ) * 0.5;
      
      const price24hAgo = currentPrice / (1 + priceChange24h);
      const price6hAgo = currentPrice / (1 + priceChange6h);
      const price1hAgo = currentPrice / (1 + priceChange1h);
      const price5mAgo = currentPrice / (1 + priceChange5m);
      
      const dailyRate = priceChange24h !== 0 ? priceChange24h : -0.02;
      const controlPoints: { time: number, price: number }[] = [];
      
      const pairSeed = parseInt(bestPair.pairAddress.slice(-8), 16);
      let seedRng = pairSeed;
      const seededRandom = () => {
        seedRng = (seedRng * 1103515245 + 12345) & 0x7fffffff;
        return seedRng / 0x7fffffff;
      };
      
      if (daysNum > 1) {
        let price = price24hAgo;
        for (let d = daysNum; d >= 1; d--) {
          const timeAgo = now - d * 24 * 60 * 60 * 1000;
          if (d > 1) {
            price = price / (1 + dailyRate * (seededRandom() * 0.5 + 0.75));
          }
          controlPoints.push({ time: timeAgo, price: Math.max(price, 0.000000000001) });
        }
      }
      
      controlPoints.push({ time: now - 24 * 60 * 60 * 1000, price: price24hAgo });
      controlPoints.push({ time: now - 6 * 60 * 60 * 1000, price: price6hAgo });
      controlPoints.push({ time: now - 1 * 60 * 60 * 1000, price: price1hAgo });
      controlPoints.push({ time: now - 5 * 60 * 1000, price: price5mAgo });
      controlPoints.push({ time: now, price: currentPrice });
      
      controlPoints.sort((a, b) => a.time - b.time);
      
      const intervalMs = daysNum <= 1 ? 15 * 60 * 1000 : daysNum <= 7 ? 60 * 60 * 1000 : 4 * 60 * 60 * 1000;
      const startTime = now - daysNum * 24 * 60 * 60 * 1000;
      
      let previousPrice = controlPoints.length > 0 ? controlPoints[0].price : price24hAgo;
      
      for (let t = startTime; t <= now; t += intervalMs) {
        let basePrice = previousPrice;
        for (let i = 0; i < controlPoints.length - 1; i++) {
          if (t >= controlPoints[i].time && t <= controlPoints[i + 1].time) {
            const ratio = (t - controlPoints[i].time) / (controlPoints[i + 1].time - controlPoints[i].time);
            basePrice = controlPoints[i].price + (controlPoints[i + 1].price - controlPoints[i].price) * ratio;
            break;
          }
        }
        if (t > controlPoints[controlPoints.length - 1].time) {
          basePrice = currentPrice;
        }
        
        const noise = (seededRandom() - 0.5) * 2 * volatility * basePrice;
        const finalPrice = Math.max(0.000000000001, basePrice + noise * 0.3);
        
        prices.push([t, finalPrice]);
        previousPrice = finalPrice;
      }
      
      if (prices.length > 0 && prices[prices.length - 1][0] !== now) {
        prices.push([now, currentPrice]);
      }
      
      console.log(`[DexScreener Chart] Generated ${prices.length} synthetic points for ${daysNum} days`);
      return prices;
    } catch (error) {
      console.error("[DexScreener Chart] Error:", error);
      return null;
    }
  }

  app.get("/api/market-chart/:symbol", async (req: Request, res: Response) => {
    try {
      const { symbol } = req.params;
      const days = req.query.days as string || "7";
      const chainId = req.query.chainId as string;
      const address = req.query.address as string;
      
      if (!symbol) {
        return res.status(400).json({ error: "Missing symbol" });
      }

      const symbolToGeckoId: Record<string, string> = {
        "ETH": "ethereum",
        "WETH": "ethereum",
        "MATIC": "polygon-ecosystem-token",
        "POL": "polygon-ecosystem-token",
        "BNB": "binancecoin",
        "BTC": "bitcoin",
        "WBTC": "bitcoin",
        "BTCB": "bitcoin",
        "USDC": "usd-coin",
        "USDT": "tether",
        "DAI": "dai",
        "SOL": "solana",
      };

      const geckoId = symbolToGeckoId[symbol.toUpperCase()];
      
      if (!geckoId && address) {
        const chain = chainId || "solana";
        const now = Date.now();
        const cacheDuration = parseInt(days) <= 1 ? 300000 : 900000;
        
        // Check cache first
        const cacheKey = `gecko_chart_${chain}_${address}_${days}`;
        const cached = historicalPriceCache[cacheKey];
        if (cached && now - cached.timestamp < cacheDuration) {
          return res.json({ prices: cached.price, cached: true, source: cached.source || "geckoterminal", isReal: cached.isReal });
        }
        
        // Try GeckoTerminal first for real OHLCV data (Solana tokens)
        if (chain === "solana" || chain === "0") {
          console.log(`[Market Chart] Trying GeckoTerminal for ${symbol} (${address})`);
          const geckoResult = await fetchGeckoTerminalOHLCV("solana", address, days);
          if (geckoResult && geckoResult.prices.length > 0) {
            historicalPriceCache[cacheKey] = { price: geckoResult.prices, timestamp: now, source: "geckoterminal", isReal: true };
            return res.json({ prices: geckoResult.prices, cached: false, source: "geckoterminal", isReal: true });
          }
        }
        
        // Fallback to DexScreener (may be synthetic)
        console.log(`[Market Chart] GeckoTerminal failed, trying DexScreener for ${symbol}`);
        const dexPrices = await fetchDexScreenerChart(chain, address, days, symbol);
        if (dexPrices && dexPrices.length > 0) {
          historicalPriceCache[cacheKey] = { price: dexPrices, timestamp: now, source: "dexscreener", isReal: false };
          return res.json({ prices: dexPrices, cached: false, source: "dexscreener", isReal: false });
        }
        
        return res.status(404).json({ error: "Chart not available for this token" });
      }
      
      if (!geckoId) {
        return res.status(404).json({ error: "Token not supported for chart data" });
      }

      const cacheKey = `chart_${geckoId}_${days}`;
      const cached = historicalPriceCache[cacheKey];
      const now = Date.now();
      const cacheDuration = parseInt(days) <= 1 ? 900000 : 3600000;
      const staleDuration = 86400000;
      
      if (cached && now - cached.timestamp < cacheDuration) {
        return res.json({ prices: cached.price, cached: true });
      }

      console.log(`[Market Chart] Fetching ${geckoId} for ${days} days`);
      
      const url = `${COINGECKO_API}/coins/${geckoId}/market_chart?vs_currency=usd&days=${days}`;
      
      try {
        const response = await fetch(url, {
          headers: { "Accept": "application/json" },
        });

        if (!response.ok) {
          console.error("[Market Chart] CoinGecko error:", response.status);
          
          if (address) {
            const chain = chainId || "solana";
            console.log("[Market Chart] Trying DexScreener fallback...");
            const dexPrices = await fetchDexScreenerChart(chain, address);
            if (dexPrices && dexPrices.length > 0) {
              const dexCacheKey = `dex_chart_${chain}_${address}`;
              historicalPriceCache[dexCacheKey] = { price: dexPrices, timestamp: now };
              return res.json({ prices: dexPrices, cached: false, source: "dexscreener" });
            }
          }
          
          if (cached && now - cached.timestamp < staleDuration) {
            console.log("[Market Chart] Returning stale cached data");
            return res.json({ prices: cached.price, cached: true, stale: true });
          }
          return res.status(502).json({ error: "Failed to fetch chart data" });
        }

        const data = await response.json();
        const prices = data.prices || [];
        
        historicalPriceCache[cacheKey] = { price: prices, timestamp: now };
        
        console.log(`[Market Chart] Fetched ${prices.length} data points`);
        return res.json({ prices, cached: false });
      } catch (fetchError) {
        console.error("[Market Chart] Fetch error:", fetchError);
        
        if (address) {
          const chain = chainId || "solana";
          const dexPrices = await fetchDexScreenerChart(chain, address);
          if (dexPrices && dexPrices.length > 0) {
            return res.json({ prices: dexPrices, cached: false, source: "dexscreener" });
          }
        }
        
        if (cached && now - cached.timestamp < staleDuration) {
          return res.json({ prices: cached.price, cached: true, stale: true });
        }
        return res.status(502).json({ error: "Failed to fetch chart data" });
      }
    } catch (error) {
      console.error("[Market Chart] Error:", error);
      res.status(500).json({ error: "Failed to fetch chart data" });
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
      const chainId = parseInt(req.query.chainId as string) || 1;
      const address = req.query.address as string;
      
      // Hardcoded fallback info for major tokens
      const staticTokenInfo: Record<string, any> = {
        SOL: {
          description: "Solana is a high-performance blockchain platform designed for decentralized apps and crypto-currencies. It uses a unique proof-of-history consensus combined with proof-of-stake for fast, secure transactions.",
          website: "https://solana.com",
          twitter: "https://twitter.com/solana",
          coingeckoId: "solana",
        },
        ETH: {
          description: "Ethereum is a decentralized blockchain platform that enables smart contracts and decentralized applications (dApps). It is the second-largest cryptocurrency by market capitalization.",
          website: "https://ethereum.org",
          twitter: "https://twitter.com/ethereum",
          coingeckoId: "ethereum",
        },
        POL: {
          description: "POL (formerly MATIC) is the native token of Polygon, a Layer 2 scaling solution for Ethereum that provides faster and cheaper transactions while maintaining security through the Ethereum mainnet.",
          website: "https://polygon.technology",
          twitter: "https://twitter.com/0xPolygon",
          coingeckoId: "matic-network",
        },
        BNB: {
          description: "BNB is the native cryptocurrency of the BNB Chain ecosystem, used for transaction fees, staking, and participating in token sales on the Binance Launchpad.",
          website: "https://www.bnbchain.org",
          twitter: "https://twitter.com/BNBCHAIN",
          coingeckoId: "binancecoin",
        },
        USDC: {
          description: "USD Coin (USDC) is a stablecoin pegged 1:1 to the US Dollar, backed by fully reserved assets and regularly audited to ensure transparency. It is issued by Circle.",
          website: "https://www.circle.com/usdc",
          twitter: "https://twitter.com/circle",
          coingeckoId: "usd-coin",
        },
        USDT: {
          description: "Tether (USDT) is the world's largest stablecoin by market cap, designed to maintain a stable value equivalent to the US Dollar.",
          website: "https://tether.to",
          twitter: "https://twitter.com/Tether_to",
          coingeckoId: "tether",
        },
        DAI: {
          description: "DAI is a decentralized stablecoin soft-pegged to the US Dollar, created and maintained by the MakerDAO protocol through a system of smart contracts.",
          website: "https://makerdao.com",
          twitter: "https://twitter.com/MakerDAO",
          coingeckoId: "dai",
        },
        WBTC: {
          description: "Wrapped Bitcoin (WBTC) is an ERC-20 token backed 1:1 by Bitcoin, allowing BTC to be used in Ethereum's DeFi ecosystem.",
          website: "https://wbtc.network",
          twitter: "https://twitter.com/WrappedBTC",
          coingeckoId: "wrapped-bitcoin",
        },
      };

      const upperSymbol = symbol.toUpperCase();
      const staticInfo = staticTokenInfo[upperSymbol];
      
      // Try to fetch live data from CoinGecko for major tokens
      if (staticInfo?.coingeckoId) {
        try {
          const cgResponse = await fetch(
            `https://api.coingecko.com/api/v3/coins/${staticInfo.coingeckoId}?localization=false&tickers=false&community_data=false&developer_data=false`
          );
          if (cgResponse.ok) {
            const cgData = await cgResponse.json();
            res.json({
              description: cgData.description?.en || staticInfo.description,
              marketCap: cgData.market_data?.market_cap?.usd || null,
              circulatingSupply: cgData.market_data?.circulating_supply || null,
              totalSupply: cgData.market_data?.total_supply || null,
              website: staticInfo.website,
              twitter: staticInfo.twitter,
            });
            return;
          }
        } catch (cgError) {
          console.error("[CoinGecko API] Error fetching token info:", cgError);
        }
        // Return static fallback for major tokens
        res.json({
          description: staticInfo.description,
          marketCap: null,
          circulatingSupply: null,
          totalSupply: null,
          website: staticInfo.website,
          twitter: staticInfo.twitter,
        });
        return;
      }
      
      // For Solana SPL tokens with an address, try DexScreener
      if (chainId === 0 && address) {
        try {
          const dexResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
          if (dexResponse.ok) {
            const dexData = await dexResponse.json();
            if (dexData.pairs && dexData.pairs.length > 0) {
              // Get the pair with the highest liquidity
              const sortedPairs = [...dexData.pairs].sort((a: any, b: any) => {
                const liqA = a.liquidity?.usd || 0;
                const liqB = b.liquidity?.usd || 0;
                return liqB - liqA;
              });
              const bestPair = sortedPairs[0];
              const tokenInfo = bestPair.baseToken?.address === address ? bestPair.baseToken : bestPair.quoteToken;
              
              // Calculate market cap from FDV or price * supply if available
              const fdv = bestPair.fdv || null;
              
              res.json({
                description: tokenInfo?.name ? `${tokenInfo.name} (${tokenInfo.symbol}) is a token on the Solana blockchain.` : null,
                marketCap: fdv,
                circulatingSupply: null,
                totalSupply: null,
                website: bestPair.info?.websites?.[0]?.url || null,
                twitter: bestPair.info?.socials?.find((s: any) => s.type === "twitter")?.url || null,
              });
              return;
            }
          }
        } catch (dexError) {
          console.error("[DexScreener API] Error fetching token info:", dexError);
        }
      }
      
      // Default empty response for unknown tokens
      res.json({ description: null, marketCap: null, circulatingSupply: null, totalSupply: null });
    } catch (error) {
      console.error("[Token Info API] Error:", error);
      res.status(500).json({ error: "Failed to fetch token info" });
    }
  });

  // GET DexScreener lookup for Solana tokens (used by useSolanaPortfolio)
  app.get("/api/dexscreener/tokens", async (req: Request, res: Response) => {
    try {
      const addresses = req.query.addresses as string;
      const chainId = req.query.chainId as string || "solana";
      
      if (!addresses) {
        return res.status(400).json({ error: "Missing addresses query param" });
      }

      const addressList = addresses.split(",").filter(a => a.trim());
      if (addressList.length === 0) {
        return res.json({ prices: {} });
      }

      const dexChainId = DEXSCREENER_CHAIN_IDS[chainId] || chainId;
      console.log(`[DexScreener API] GET request for ${addressList.length} tokens on ${dexChainId}`);

      // DexScreener allows up to 30 addresses comma-separated
      const limitedAddresses = addressList.slice(0, 30);
      const url = `${DEXSCREENER_API}/tokens/v1/${dexChainId}/${limitedAddresses.join(",")}`;
      
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
      });

      if (!response.ok) {
        console.error("[DexScreener API] GET error:", response.status);
        return res.json({ prices: {} });
      }

      const data = await response.json();
      const pairs = data || [];
      
      // Build prices map keyed by token address
      const prices: Record<string, any> = {};
      
      for (const pair of pairs) {
        const tokenAddr = pair.baseToken?.address;
        if (!tokenAddr) continue;
        
        // Keep the pair with highest liquidity
        if (!prices[tokenAddr] || (pair.liquidity?.usd || 0) > (prices[tokenAddr].liquidity || 0)) {
          prices[tokenAddr] = {
            price: pair.priceUsd ? parseFloat(pair.priceUsd) : null,
            change24h: pair.priceChange?.h24 || 0,
            symbol: pair.baseToken?.symbol,
            name: pair.baseToken?.name,
            liquidity: pair.liquidity?.usd,
            logoUrl: pair.info?.imageUrl || null,
          };
        }
      }

      console.log(`[DexScreener API] Found prices for ${Object.keys(prices).length} tokens`);
      res.json({ prices });
    } catch (error) {
      console.error("[DexScreener API] GET error:", error);
      res.json({ prices: {} });
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

  app.get("/api/solana/balance/:address", async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      
      if (!address) {
        return res.status(400).json({ error: "Missing address" });
      }

      console.log(`[Solana API] Fetching balance for ${address.slice(0, 8)}...`);
      const balance = await getSolanaBalance(address);
      res.json(balance);
    } catch (error) {
      console.error("[Solana API] Balance error:", error);
      res.status(500).json({ error: "Failed to fetch Solana balance" });
    }
  });

  app.get("/api/solana/portfolio/:address", async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      
      if (!address) {
        return res.status(400).json({ error: "Missing address" });
      }

      console.log(`[Solana API] Fetching portfolio for ${address.slice(0, 8)}...`);
      const portfolio = await getSolanaPortfolio(address);
      res.json(portfolio);
    } catch (error) {
      console.error("[Solana API] Portfolio error:", error);
      res.status(500).json({ error: "Failed to fetch Solana portfolio" });
    }
  });

  app.get("/api/solana/history/:address", async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const limit = parseInt(req.query.limit as string) || 20;
      
      if (!address) {
        return res.status(400).json({ error: "Missing address" });
      }

      console.log(`[Solana API] Fetching transaction history for ${address.slice(0, 8)}...`);
      const history = await getSolanaTransactionHistory(address, limit);
      res.json(history);
    } catch (error) {
      console.error("[Solana API] History error:", error);
      res.status(500).json({ error: "Failed to fetch Solana transaction history" });
    }
  });

  app.get("/api/solana/token-metadata/:mint", async (req: Request, res: Response) => {
    try {
      const { mint } = req.params;
      
      if (!mint) {
        return res.status(400).json({ error: "Missing mint address" });
      }

      console.log(`[Solana API] Fetching token metadata for ${mint.slice(0, 8)}...`);
      const metadata = await getSplTokenMetadata(mint);
      
      if (!metadata) {
        return res.status(404).json({ error: "Token not found or invalid mint address" });
      }
      
      res.json(metadata);
    } catch (error) {
      console.error("[Solana API] Token metadata error:", error);
      res.status(500).json({ error: "Failed to fetch token metadata" });
    }
  });

  app.get("/api/solana/check-ata", async (req: Request, res: Response) => {
    try {
      const { mint, owner } = req.query;
      
      if (!mint || !owner) {
        return res.status(400).json({ error: "Missing mint or owner" });
      }

      const exists = await checkAtaExists(mint as string, owner as string);
      res.json({ exists });
    } catch (error) {
      console.error("[Solana API] Check ATA error:", error);
      res.status(500).json({ error: "Failed to check token account" });
    }
  });

  app.get("/api/solana/estimate-fee", async (req: Request, res: Response) => {
    try {
      const isToken = req.query.isToken === "true";
      const estimate = await estimateSolanaFee(isToken);
      res.json(estimate);
    } catch (error) {
      console.error("[Solana API] Fee estimation error:", error);
      res.status(500).json({ error: "Failed to estimate fee" });
    }
  });

  app.post("/api/solana/prepare-sol-transfer", async (req: Request, res: Response) => {
    try {
      const { fromAddress, toAddress, amountSol } = req.body;
      
      if (!fromAddress || !toAddress || !amountSol) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      console.log(`[Solana API] Preparing SOL transfer: ${amountSol} SOL`);
      const prepared = await prepareSolTransfer(fromAddress, toAddress, amountSol);
      res.json(prepared);
    } catch (error) {
      console.error("[Solana API] Prepare SOL transfer error:", error);
      res.status(500).json({ error: "Failed to prepare transaction" });
    }
  });

  app.post("/api/solana/prepare-spl-transfer", async (req: Request, res: Response) => {
    try {
      const { fromAddress, toAddress, mintAddress, amount, decimals, allowCreateAta = true } = req.body;
      
      if (!fromAddress || !toAddress || !mintAddress || !amount || decimals === undefined) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      console.log(`[Solana API] Preparing SPL transfer: ${amount} tokens`);
      const prepared = await prepareSplTransfer({
        fromAddress,
        toAddress,
        mintAddress,
        amount,
        decimals,
        allowCreateAta,
      });
      res.json(prepared);
    } catch (error: any) {
      console.error("[Solana API] Prepare SPL transfer error:", error);
      res.status(500).json({ error: error.message || "Failed to prepare SPL transaction" });
    }
  });

  app.post("/api/solana/send-signed-transaction", async (req: Request, res: Response) => {
    try {
      const { transactionBase64, signatureBase64, publicKeyBase58 } = req.body;
      
      if (!transactionBase64 || !signatureBase64 || !publicKeyBase58) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      console.log(`[Solana API] Sending signed transaction...`);
      const result = await sendSignedTransaction(transactionBase64, signatureBase64, publicKeyBase58);
      console.log(`[Solana API] Transaction ${result.signature}: ${result.status}`);
      res.json(result);
    } catch (error: any) {
      console.error("[Solana API] Send transaction error:", error);
      res.status(500).json({ error: error.message || "Failed to send transaction" });
    }
  });

  app.get("/api/approvals/:address", async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const chainId = req.query.chainId as string;
      
      if (!address || !chainId) {
        return res.status(400).json({ error: "Missing address or chainId" });
      }

      const apiKey = process.env.ETHERSCAN_API_KEY;
      
      if (!apiKey) {
        console.log("[Approvals API] No Etherscan API key configured, returning empty");
        return res.json({ approvals: [] });
      }
      
      const params = new URLSearchParams({
        chainid: chainId,
        module: "account",
        action: "txlist",
        address: address,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: "200",
        sort: "desc",
        apikey: apiKey,
      });

      const url = `${ETHERSCAN_V2_API}?${params.toString()}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status !== "1" || !Array.isArray(data.result)) {
        return res.json({ approvals: [] });
      }
      
      const APPROVE_SELECTOR = "0x095ea7b3";
      const approvals: { tokenAddress: string; spender: string; txHash: string; timestamp: number }[] = [];
      
      for (const tx of data.result) {
        if (tx.input && tx.input.toLowerCase().startsWith(APPROVE_SELECTOR) && tx.isError === "0") {
          const spender = "0x" + tx.input.slice(34, 74);
          
          approvals.push({
            tokenAddress: tx.to,
            spender,
            txHash: tx.hash,
            timestamp: parseInt(tx.timeStamp) * 1000,
          });
        }
      }
      
      const uniqueApprovals = Array.from(
        new Map(approvals.map(a => [`${a.tokenAddress}-${a.spender}`, a])).values()
      );
      
      res.json({ approvals: uniqueApprovals });
    } catch (error) {
      console.error("[Approvals API] Error:", error);
      res.status(500).json({ error: "Failed to fetch approvals" });
    }
  });

  app.get("/api/solana/token-accounts/:owner", async (req: Request, res: Response) => {
    try {
      const { owner } = req.params;
      
      if (!owner) {
        return res.status(400).json({ error: "Missing owner address" });
      }

      const { getTokenAccountsWithDelegates } = await import("./solana-api");
      const tokenAccounts = await getTokenAccountsWithDelegates(owner);
      
      const formattedAccounts = tokenAccounts.map(account => ({
        pubkey: account.pubkey,
        account: {
          data: {
            parsed: {
              info: {
                mint: account.mint,
                owner: account.owner,
                delegate: account.delegate,
                delegatedAmount: account.delegate ? {
                  amount: account.delegatedAmount,
                  decimals: account.decimals,
                  uiAmount: parseInt(account.delegatedAmount) / Math.pow(10, account.decimals),
                } : null,
                state: account.state,
              },
              type: "account",
            },
            program: "spl-token",
            space: 165,
          },
          executable: false,
          lamports: 0,
          owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        },
      }));
      
      res.json({ tokenAccounts: formattedAccounts });
    } catch (error) {
      console.error("[Solana API] Token accounts error:", error);
      res.status(500).json({ error: "Failed to fetch token accounts" });
    }
  });

  app.post("/api/solana/prepare-revoke-delegate", async (req: Request, res: Response) => {
    try {
      const { tokenAccountAddress, ownerAddress } = req.body;
      
      if (!tokenAccountAddress) {
        return res.status(400).json({ error: "Missing tokenAccountAddress" });
      }

      const { prepareRevokeDelegateTransaction } = await import("./solana-api");
      const prepared = await prepareRevokeDelegateTransaction(
        tokenAccountAddress, 
        ownerAddress || tokenAccountAddress
      );
      
      res.json(prepared);
    } catch (error: any) {
      console.error("[Solana API] Prepare revoke delegate error:", error);
      res.status(500).json({ error: error.message || "Failed to prepare revoke transaction" });
    }
  });

  app.post("/api/solana/send-raw-transaction", async (req: Request, res: Response) => {
    try {
      const { transactionBase64 } = req.body;
      
      if (!transactionBase64) {
        return res.status(400).json({ error: "Missing transactionBase64" });
      }

      const { sendRawTransaction } = await import("./solana-api");
      const result = await sendRawTransaction(transactionBase64);
      
      res.json(result);
    } catch (error: any) {
      console.error("[Solana API] Send raw transaction error:", error);
      res.status(500).json({ error: error.message || "Failed to send transaction" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
