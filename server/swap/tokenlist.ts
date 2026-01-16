import { swapConfig } from "./config";
import type { TokenInfo } from "./types";
import * as fs from "fs";
import * as path from "path";

const CACHE_DIR = path.join(process.cwd(), "server", ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "tokenlist.json");

const HARDCODED_TOKENS: TokenInfo[] = [
  { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", decimals: 9, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" },
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png" },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png" },
  { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", decimals: 5, logoURI: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I" },
  { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6, logoURI: "https://static.jup.ag/jup/icon.png" },
];

interface CachedList {
  tokens: TokenInfo[];
  fetchedAt: number;
}

let memoryCache: TokenInfo[] = [];
let memoryCacheTime = 0;

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
      return data.tokens.map(normalizeToken).filter((t): t is TokenInfo => t !== null);
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
    console.log(`[TokenList] Using disk cache (${diskCache.tokens.length} tokens)`);
    memoryCache = diskCache.tokens;
    memoryCacheTime = diskCache.fetchedAt;
    return diskCache.tokens;
  }
  
  console.warn("[TokenList] All sources failed, using hardcoded tokens");
  memoryCache = HARDCODED_TOKENS;
  memoryCacheTime = Date.now();
  return HARDCODED_TOKENS;
}

export async function getTokenList(): Promise<TokenInfo[]> {
  const age = Date.now() - memoryCacheTime;
  
  if (memoryCache.length === 0 || age > swapConfig.tokenListTtlMs) {
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

export async function searchTokens(query: string, limit: number = 50): Promise<TokenInfo[]> {
  const tokens = await getTokenList();
  const q = query.toLowerCase().trim();
  
  if (!q) {
    const popular = ["SOL", "USDC", "USDT", "JUP", "BONK", "RAY", "ORCA", "PYTH", "WIF", "JTO"];
    const popularTokens = popular
      .map(sym => tokens.find(t => t.symbol.toUpperCase() === sym))
      .filter((t): t is TokenInfo => t !== null);
    
    const remaining = tokens
      .filter(t => !popular.includes(t.symbol.toUpperCase()))
      .slice(0, limit - popularTokens.length);
    
    return [...popularTokens, ...remaining].slice(0, limit);
  }
  
  if (q.length >= 32) {
    const exactMint = tokens.find(t => t.mint.toLowerCase() === q);
    if (exactMint) return [exactMint];
    
    return [{ mint: query, symbol: "UNKNOWN", name: "Unknown Token", decimals: 9 }];
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
