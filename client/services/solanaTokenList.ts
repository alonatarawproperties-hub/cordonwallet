import AsyncStorage from "@react-native-async-storage/async-storage";
import { POPULAR_TOKENS } from "@/constants/solanaSwap";
import { getApiUrl } from "@/lib/query-client";
import { swapLogger } from "@/lib/swapLogger";

const TOKEN_LIST_KEY = "solana_token_list_v3";
const TOKEN_LIST_TTL_MS = 12 * 60 * 60 * 1000;
const BACKGROUND_REFRESH_INTERVAL = 6 * 60 * 60 * 1000;

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

interface CachedTokenList {
  tokens: TokenInfo[];
  fetchedAt: number;
}

const FALLBACK_TOKENS: TokenInfo[] = [
  { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", decimals: 9, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" },
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png" },
  { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://coin-images.coingecko.com/coins/images/325/large/Tether.png" },
  ...POPULAR_TOKENS.filter(t => !["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"].includes(t.mint)),
];

let tokenCache: Map<string, TokenInfo> = new Map();
let tokenList: TokenInfo[] = [];
let cacheLoaded = false;
let lastFetchAttempt = 0;
let isFetching = false;

async function loadCacheFromStorage(): Promise<void> {
  if (cacheLoaded) return;
  
  try {
    const stored = await AsyncStorage.getItem(TOKEN_LIST_KEY);
    if (stored) {
      const cached: CachedTokenList = JSON.parse(stored);
      
      if (cached.tokens && cached.tokens.length > 0) {
        tokenList = cached.tokens;
        tokenCache = new Map(cached.tokens.map(t => [t.mint, t]));
        cacheLoaded = true;
        swapLogger.info("TokenList", `Loaded ${tokenList.length} tokens from cache`);
        return;
      }
    }
  } catch (error) {
    swapLogger.transient("TokenList", "Failed to load cache, using fallback");
  }
  
  tokenList = [...FALLBACK_TOKENS];
  FALLBACK_TOKENS.forEach(t => tokenCache.set(t.mint, t));
  cacheLoaded = true;
}

async function saveCacheToStorage(): Promise<void> {
  try {
    const cached: CachedTokenList = {
      tokens: tokenList,
      fetchedAt: Date.now(),
    };
    await AsyncStorage.setItem(TOKEN_LIST_KEY, JSON.stringify(cached));
  } catch (error) {
    swapLogger.transient("TokenList", "Failed to save cache");
  }
}

function shouldRefresh(): boolean {
  if (isFetching) return false;
  
  const now = Date.now();
  if (now - lastFetchAttempt < 30000) return false;
  
  return tokenList.length < 100;
}

export async function fetchTokenList(): Promise<TokenInfo[]> {
  if (isFetching) {
    await loadCacheFromStorage();
    return tokenList;
  }
  
  isFetching = true;
  lastFetchAttempt = Date.now();
  
  try {
    const baseUrl = getApiUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(`${baseUrl}/api/jupiter/tokens`, {
      signal: controller.signal,
      headers: { "Accept": "application/json" },
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Token list fetch failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    let tokens: TokenInfo[] = [];
    if (Array.isArray(data)) {
      tokens = data.slice(0, 500).map((t: any) => ({
        mint: t.address || t.mint,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        logoURI: t.logoURI,
      }));
    } else if (data.tokens && Array.isArray(data.tokens)) {
      tokens = data.tokens.slice(0, 500).map((t: any) => ({
        mint: t.address || t.mint,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        logoURI: t.logoURI,
      }));
    }
    
    if (tokens.length > 0) {
      FALLBACK_TOKENS.forEach(ft => {
        if (!tokens.find(t => t.mint === ft.mint)) {
          tokens.unshift(ft);
        }
      });
      
      tokenList = tokens;
      tokenCache = new Map(tokens.map(t => [t.mint, t]));
      cacheLoaded = true;
      
      await saveCacheToStorage();
      swapLogger.info("TokenList", `Fetched and cached ${tokenList.length} tokens`);
    }
    
    return tokenList;
  } catch (error: any) {
    swapLogger.transient("TokenList", `Fetch failed: ${error.message}`);
    await loadCacheFromStorage();
    return tokenList;
  } finally {
    isFetching = false;
  }
}

export async function getTokenByMint(mint: string): Promise<TokenInfo | null> {
  await loadCacheFromStorage();
  
  const cached = tokenCache.get(mint);
  if (cached) return cached;
  
  if (!isValidMintAddress(mint)) {
    return null;
  }
  
  try {
    const baseUrl = getApiUrl();
    const response = await fetch(`${baseUrl}/api/solana/token-metadata/${mint}`, {
      headers: { "Accept": "application/json" },
    });
    
    if (response.ok) {
      const metadata = await response.json();
      if (metadata && metadata.symbol) {
        const token: TokenInfo = {
          mint,
          symbol: metadata.symbol,
          name: metadata.name || metadata.symbol,
          decimals: metadata.decimals || 9,
          logoURI: metadata.logoUri,
        };
        tokenCache.set(mint, token);
        return token;
      }
    }
  } catch (err) {
    swapLogger.transient("TokenList", "Failed to fetch token metadata");
  }
  
  return null;
}

export function isValidMintAddress(mint: string): boolean {
  if (!mint || mint.length < 32 || mint.length > 44) return false;
  
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  return base58Regex.test(mint);
}

export async function resolveManualMint(mint: string): Promise<TokenInfo | null> {
  if (!isValidMintAddress(mint)) {
    return null;
  }
  
  const existing = tokenCache.get(mint);
  if (existing) return existing;
  
  const fetched = await getTokenByMint(mint);
  if (fetched) return fetched;
  
  const unknownToken: TokenInfo = {
    mint,
    symbol: `${mint.slice(0, 4)}...${mint.slice(-4)}`,
    name: "Unknown Token",
    decimals: 9,
    logoURI: undefined,
  };
  
  tokenCache.set(mint, unknownToken);
  return unknownToken;
}

export async function searchTokens(query: string, limit: number = 20): Promise<TokenInfo[]> {
  await loadCacheFromStorage();
  
  const q = query.toLowerCase().trim();
  if (!q) return getPopularTokens();
  
  if (isValidMintAddress(q)) {
    const token = await resolveManualMint(q);
    if (token) return [token];
  }
  
  const results = tokenList
    .filter(t => 
      t.symbol.toLowerCase().includes(q) || 
      t.name.toLowerCase().includes(q) ||
      t.mint.toLowerCase().startsWith(q)
    )
    .sort((a, b) => {
      const aExact = a.symbol.toLowerCase() === q;
      const bExact = b.symbol.toLowerCase() === q;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      
      const aSymbolMatch = a.symbol.toLowerCase().startsWith(q);
      const bSymbolMatch = b.symbol.toLowerCase().startsWith(q);
      if (aSymbolMatch && !bSymbolMatch) return -1;
      if (!aSymbolMatch && bSymbolMatch) return 1;
      
      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, limit);
  
  return results;
}

export function getPopularTokens(): TokenInfo[] {
  return FALLBACK_TOKENS.slice(0, 10);
}

export async function initTokenList(): Promise<void> {
  await loadCacheFromStorage();
  
  if (shouldRefresh()) {
    fetchTokenList().catch(() => {});
  }
}

export function getTokenLogoUri(mint: string): string | undefined {
  return tokenCache.get(mint)?.logoURI;
}

export function formatTokenAmount(amount: number | string, decimals: number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "0";
  
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)}M`;
  } else if (num >= 1000) {
    return `${(num / 1000).toFixed(2)}K`;
  } else if (num >= 1) {
    return num.toFixed(Math.min(4, decimals));
  } else if (num > 0) {
    return num.toFixed(Math.min(6, decimals));
  }
  return "0";
}

export function parseTokenAmount(amount: string, decimals: number): bigint {
  const [intPart, fracPart = ""] = amount.split(".");
  const paddedFrac = fracPart.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(intPart + paddedFrac);
}

export function formatBaseUnits(baseUnits: bigint | string, decimals: number): string {
  const units = typeof baseUnits === "string" ? BigInt(baseUnits) : baseUnits;
  const divisor = BigInt(10 ** decimals);
  const intPart = units / divisor;
  const fracPart = units % divisor;
  const fracStr = fracPart.toString().padStart(decimals, "0");
  return `${intPart}.${fracStr}`.replace(/\.?0+$/, "") || "0";
}

export function isCacheValid(): boolean {
  return cacheLoaded && tokenList.length > 0;
}

export function getCacheAge(): number {
  return Date.now() - lastFetchAttempt;
}
