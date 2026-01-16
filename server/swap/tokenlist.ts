import { swapConfig } from "./config";
import type { TokenInfo } from "./types";
import * as fs from "fs";
import * as path from "path";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

const CACHE_DIR = path.join(process.cwd(), "server", ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "tokenlist.json");

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const HARDCODED_TOKENS: TokenInfo[] = [
  { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", decimals: 9, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png", verified: true, sources: ["hardcoded"] },
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png", verified: true, sources: ["hardcoded"] },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png", verified: true, sources: ["hardcoded"] },
  { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", decimals: 5, logoURI: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I", verified: true, sources: ["hardcoded"] },
  { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6, logoURI: "https://static.jup.ag/jup/icon.png", verified: true, sources: ["hardcoded"] },
];

interface CachedList {
  tokens: TokenInfo[];
  fetchedAt: number;
}

interface CustomTokenCacheEntry {
  token: TokenInfo;
  expiresAt: number;
  negative?: boolean;
}

let memoryCache: TokenInfo[] = [];
let memoryCacheTime = 0;

const customTokenCache = new Map<string, CustomTokenCacheEntry>();
const inflightRequests = new Map<string, Promise<TokenInfo>>();

const MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const DISK_TTL_MS = 24 * 60 * 60 * 1000;
const SUCCESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;

let concurrentFetches = 0;
const MAX_CONCURRENT_FETCHES = 5;

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function loadFromDisk(): CachedList | null {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("[TokenList] Failed to load from disk:", err);
  }
  return null;
}

function saveToDisk(tokens: TokenInfo[]): void {
  try {
    ensureCacheDir();
    const cached: CachedList = { tokens, fetchedAt: Date.now() };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cached));
  } catch (err) {
    console.error("[TokenList] Failed to save to disk:", err);
  }
}

async function fetchFromUrl(url: string): Promise<TokenInfo[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (Array.isArray(data)) {
      return data.map(normalizeToken).filter((t): t is TokenInfo => t !== null);
    }
    
    if (data.tokens && Array.isArray(data.tokens)) {
      return data.tokens.map(normalizeToken).filter((t: TokenInfo | null): t is TokenInfo => t !== null);
    }
    
    throw new Error("Invalid token list format");
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

function normalizeToken(t: any): TokenInfo | null {
  if (!t) return null;
  
  const mint = t.mint || t.address;
  const symbol = t.symbol;
  const name = t.name;
  const decimals = typeof t.decimals === "number" ? t.decimals : 9;
  
  if (!mint || !symbol) return null;
  
  return {
    mint,
    symbol,
    name: name || symbol,
    decimals,
    logoURI: t.logoURI || t.logo,
    verified: true,
    sources: ["jupiter"],
    lastUpdated: Date.now(),
  };
}

export async function refreshTokenList(): Promise<TokenInfo[]> {
  const urls = [
    swapConfig.tokenListPrimary,
    swapConfig.tokenListFallback,
    "https://token.jup.ag/all",
  ];
  
  for (const url of urls) {
    try {
      console.log(`[TokenList] Fetching from ${url}...`);
      const tokens = await fetchFromUrl(url);
      if (tokens.length > 0) {
        console.log(`[TokenList] Fetched ${tokens.length} tokens from ${url}`);
        memoryCache = tokens;
        memoryCacheTime = Date.now();
        saveToDisk(tokens);
        return tokens;
      }
    } catch (err: any) {
      console.warn(`[TokenList] Failed to fetch from ${url}:`, err.message);
    }
  }
  
  const diskCache = loadFromDisk();
  if (diskCache && diskCache.tokens.length > 0) {
    const diskAge = Date.now() - diskCache.fetchedAt;
    if (diskAge < DISK_TTL_MS) {
      console.log(`[TokenList] Using disk cache (${diskCache.tokens.length} tokens, age: ${Math.round(diskAge / 60000)}min)`);
      memoryCache = diskCache.tokens;
      memoryCacheTime = diskCache.fetchedAt;
      return deduplicateTokens([...HARDCODED_TOKENS, ...diskCache.tokens]);
    }
  }
  
  console.warn("[TokenList] All sources failed, using hardcoded + stale disk cache");
  const staleTokens = diskCache?.tokens || [];
  return deduplicateTokens([...HARDCODED_TOKENS, ...staleTokens]);
}

function deduplicateTokens(tokens: TokenInfo[]): TokenInfo[] {
  const seen = new Map<string, TokenInfo>();
  for (const t of tokens) {
    const key = t.mint.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, t);
    }
  }
  return Array.from(seen.values());
}

export async function getTokenList(): Promise<TokenInfo[]> {
  const age = Date.now() - memoryCacheTime;
  
  if (memoryCache.length === 0 || age > MEMORY_TTL_MS) {
    return refreshTokenList();
  }
  
  return memoryCache;
}

export async function getToken(mint: string): Promise<TokenInfo | null> {
  const tokens = await getTokenList();
  const found = tokens.find(t => t.mint.toLowerCase() === mint.toLowerCase());
  
  if (found) return found;
  
  const hardcoded = HARDCODED_TOKENS.find(t => t.mint.toLowerCase() === mint.toLowerCase());
  if (hardcoded) return hardcoded;
  
  return null;
}

function validateMint(mint: string): PublicKey {
  try {
    return new PublicKey(mint);
  } catch {
    throw new Error("Invalid mint address");
  }
}

function getHeliusEndpoint(): string | null {
  if (process.env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  }
  
  const rpcUrl = process.env.SOLANA_RPC_URL || "";
  if (rpcUrl.includes("helius")) {
    return rpcUrl;
  }
  
  return null;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = 4000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

interface HeliusAssetResult {
  name?: string;
  symbol?: string;
  logoURI?: string;
  decimals?: number;
}

async function fetchHeliusDASAsset(mint: string): Promise<HeliusAssetResult | null> {
  const endpoint = getHeliusEndpoint();
  if (!endpoint) return null;
  
  const maxRetries = 2;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (concurrentFetches >= MAX_CONCURRENT_FETCHES) {
        await new Promise(r => setTimeout(r, 100));
      }
      concurrentFetches++;
      
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "cordon",
          method: "getAsset",
          params: { id: mint },
        }),
      }, 4000);
      
      concurrentFetches--;
      
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        return null;
      }
      
      const data = await response.json();
      const result = data?.result;
      
      if (!result) return null;
      
      const name = result?.content?.metadata?.name?.trim();
      const symbol = result?.content?.metadata?.symbol?.trim();
      const image = result?.content?.links?.image || result?.content?.files?.[0]?.uri;
      const decimals = result?.token_info?.decimals;
      
      return {
        name: name || undefined,
        symbol: symbol || undefined,
        logoURI: image || undefined,
        decimals: typeof decimals === "number" ? decimals : undefined,
      };
    } catch (err: any) {
      concurrentFetches = Math.max(0, concurrentFetches - 1);
      lastError = err;
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  
  if (lastError) {
    console.warn(`[TokenList] Helius DAS fetch failed for ${mint}:`, lastError.message);
  }
  return null;
}

interface MetaplexResult {
  name?: string;
  symbol?: string;
  logoURI?: string;
}

async function fetchMetaplexMetadata(mint: string, connection: Connection): Promise<MetaplexResult | null> {
  try {
    const mintPubkey = new PublicKey(mint);
    
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mintPubkey.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    );
    
    const acct = await connection.getAccountInfo(pda);
    if (!acct) return null;
    
    const data = acct.data;
    
    let offset = 1 + 32 + 32;
    
    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    const name = data.slice(offset, offset + nameLen).toString("utf-8").replace(/\0/g, "").trim();
    offset += nameLen;
    
    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    const symbol = data.slice(offset, offset + symbolLen).toString("utf-8").replace(/\0/g, "").trim();
    offset += symbolLen;
    
    const uriLen = data.readUInt32LE(offset);
    offset += 4;
    const uri = data.slice(offset, offset + uriLen).toString("utf-8").replace(/\0/g, "").trim();
    
    let logoURI: string | undefined;
    if (uri && (uri.startsWith("http://") || uri.startsWith("https://"))) {
      try {
        const jsonResp = await fetchWithTimeout(uri, {}, 4000);
        if (jsonResp.ok) {
          const json = await jsonResp.json();
          logoURI = json.image || undefined;
        }
      } catch {
      }
    }
    
    return {
      name: name || undefined,
      symbol: symbol || undefined,
      logoURI,
    };
  } catch (err: any) {
    console.warn(`[TokenList] Metaplex fetch failed for ${mint}:`, err.message);
    return null;
  }
}

async function fetchOnChainDecimals(mint: string, connection: Connection): Promise<number | null> {
  try {
    const mintPubkey = new PublicKey(mint);
    const mintInfo = await getMint(connection, mintPubkey);
    return mintInfo.decimals;
  } catch (err: any) {
    console.warn(`[TokenList] On-chain decimals fetch failed for ${mint}:`, err.message);
    return null;
  }
}

function buildTokenInfo(
  mint: string,
  jupiterToken: TokenInfo | null,
  helius: HeliusAssetResult | null,
  metaplex: MetaplexResult | null,
  onChainDecimals: number | null
): TokenInfo {
  const sources: string[] = [];
  
  let decimals: number;
  if (jupiterToken) {
    decimals = jupiterToken.decimals;
    sources.push("jupiter");
  } else if (helius?.decimals !== undefined) {
    decimals = helius.decimals;
    sources.push("helius-das");
  } else if (onChainDecimals !== null) {
    decimals = onChainDecimals;
    sources.push("on-chain");
  } else {
    decimals = 9;
  }
  
  let symbol = "UNKNOWN";
  if (jupiterToken?.symbol) {
    symbol = jupiterToken.symbol;
  } else if (helius?.symbol) {
    symbol = helius.symbol;
    if (!sources.includes("helius-das")) sources.push("helius-das");
  } else if (metaplex?.symbol) {
    symbol = metaplex.symbol;
    sources.push("metaplex");
  }
  
  let name = "Unknown Token";
  if (jupiterToken?.name) {
    name = jupiterToken.name;
  } else if (helius?.name) {
    name = helius.name;
  } else if (metaplex?.name) {
    name = metaplex.name;
  }
  
  let logoURI: string | undefined;
  if (jupiterToken?.logoURI) {
    logoURI = jupiterToken.logoURI;
  } else if (helius?.logoURI) {
    logoURI = helius.logoURI;
  } else if (metaplex?.logoURI) {
    logoURI = metaplex.logoURI;
  }
  
  const tags: string[] = [];
  if (mint.endsWith("pump")) {
    tags.push("pumpfun");
  }
  
  const verified = !!jupiterToken;
  
  return {
    mint,
    symbol,
    name,
    decimals,
    logoURI,
    verified,
    sources,
    lastUpdated: Date.now(),
    tags: tags.length > 0 ? tags : undefined,
    isCustom: !verified,
  };
}

export async function resolveToken(mint: string): Promise<{ token: TokenInfo } | { error: string; code: number }> {
  try {
    validateMint(mint);
  } catch {
    return { error: "Invalid mint address", code: 400 };
  }
  
  const hardcoded = HARDCODED_TOKENS.find(t => t.mint.toLowerCase() === mint.toLowerCase());
  if (hardcoded) {
    return { token: hardcoded };
  }
  
  const cached = customTokenCache.get(mint.toLowerCase());
  if (cached && Date.now() < cached.expiresAt) {
    if (cached.negative) {
      return { error: "Token not found", code: 404 };
    }
    return { token: cached.token };
  }
  
  const jupiterToken = await getToken(mint);
  if (jupiterToken) {
    const result: TokenInfo = {
      ...jupiterToken,
      verified: true,
      sources: ["jupiter"],
      lastUpdated: Date.now(),
      isCustom: false,
    };
    customTokenCache.set(mint.toLowerCase(), {
      token: result,
      expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS,
    });
    return { token: result };
  }
  
  const existingInflight = inflightRequests.get(mint.toLowerCase());
  if (existingInflight) {
    const token = await existingInflight;
    return { token };
  }
  
  const resolvePromise = (async (): Promise<TokenInfo> => {
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");
    
    const [helius, onChainDecimals] = await Promise.all([
      fetchHeliusDASAsset(mint),
      fetchOnChainDecimals(mint, connection),
    ]);
    
    let metaplex: MetaplexResult | null = null;
    if (!helius?.symbol || !helius?.name || !helius?.logoURI) {
      metaplex = await fetchMetaplexMetadata(mint, connection);
    }
    
    if (onChainDecimals === null && helius?.decimals === undefined) {
      throw new Error("Token not found on-chain");
    }
    
    return buildTokenInfo(mint, null, helius, metaplex, onChainDecimals);
  })();
  
  inflightRequests.set(mint.toLowerCase(), resolvePromise);
  
  try {
    const token = await resolvePromise;
    customTokenCache.set(mint.toLowerCase(), {
      token,
      expiresAt: Date.now() + SUCCESS_CACHE_TTL_MS,
    });
    return { token };
  } catch (err: any) {
    customTokenCache.set(mint.toLowerCase(), {
      token: { mint, symbol: "UNKNOWN", name: "Unknown Token", decimals: 9 },
      expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS,
      negative: true,
    });
    return { error: err.message || "Token lookup failed", code: 404 };
  } finally {
    inflightRequests.delete(mint.toLowerCase());
  }
}

export async function searchTokens(query: string, limit: number = 50): Promise<TokenInfo[]> {
  const tokens = await getTokenList();
  const q = query.toLowerCase().trim();
  
  if (!q) {
    const popular = ["SOL", "USDC", "USDT", "JUP", "BONK", "RAY", "ORCA", "PYTH", "WIF", "JTO"];
    const popularTokens = popular
      .map(sym => tokens.find((t: TokenInfo) => t.symbol.toUpperCase() === sym))
      .filter((t): t is TokenInfo => t !== null);
    
    const remaining = tokens
      .filter(t => !popular.includes(t.symbol.toUpperCase()))
      .slice(0, limit - popularTokens.length);
    
    return [...popularTokens, ...remaining].slice(0, limit);
  }
  
  if (q.length >= 32) {
    const exactMint = tokens.find(t => t.mint.toLowerCase() === q);
    if (exactMint) return [exactMint];
    return [];
  }
  
  const results = tokens
    .filter(t =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q)
    )
    .sort((a, b) => {
      const aStartsWith = a.symbol.toLowerCase().startsWith(q);
      const bStartsWith = b.symbol.toLowerCase().startsWith(q);
      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;
      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, limit);
  
  return results;
}

export function initTokenList(): void {
  refreshTokenList().catch(err => {
    console.error("[TokenList] Initial refresh failed:", err);
  });
}
