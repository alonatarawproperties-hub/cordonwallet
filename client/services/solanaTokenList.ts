import AsyncStorage from "@react-native-async-storage/async-storage";
import { POPULAR_TOKENS, SOL_MINT } from "@/constants/solanaSwap";

const TOKEN_LIST_KEY = "solana_token_list_v1";
const TOKEN_LIST_TTL_MS = 24 * 60 * 60 * 1000;
const JUPITER_TOKENS_URL = "https://tokens.jup.ag/tokens?tags=verified";

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

let tokenCache: Map<string, TokenInfo> = new Map();
let tokenList: TokenInfo[] = [];
let cacheLoaded = false;

async function loadCacheFromStorage(): Promise<void> {
  if (cacheLoaded) return;
  
  try {
    const stored = await AsyncStorage.getItem(TOKEN_LIST_KEY);
    if (stored) {
      const cached: CachedTokenList = JSON.parse(stored);
      const age = Date.now() - cached.fetchedAt;
      
      if (age < TOKEN_LIST_TTL_MS && cached.tokens.length > 0) {
        tokenList = cached.tokens;
        tokenCache = new Map(cached.tokens.map(t => [t.mint, t]));
        cacheLoaded = true;
        console.log(`[TokenList] Loaded ${tokenList.length} tokens from cache`);
        return;
      }
    }
  } catch (error) {
    console.error("[TokenList] Failed to load cache:", error);
  }
  
  POPULAR_TOKENS.forEach(t => {
    tokenCache.set(t.mint, t);
    tokenList.push(t);
  });
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
    console.error("[TokenList] Failed to save cache:", error);
  }
}

export async function fetchTokenList(): Promise<TokenInfo[]> {
  try {
    const response = await fetch(JUPITER_TOKENS_URL);
    if (!response.ok) {
      throw new Error(`Jupiter token list fetch failed: ${response.status}`);
    }
    
    const data: TokenInfo[] = await response.json();
    
    tokenList = data.map(t => ({
      mint: t.mint || (t as any).address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      logoURI: t.logoURI,
    }));
    
    tokenCache = new Map(tokenList.map(t => [t.mint, t]));
    cacheLoaded = true;
    
    await saveCacheToStorage();
    console.log(`[TokenList] Fetched and cached ${tokenList.length} tokens`);
    
    return tokenList;
  } catch (error) {
    console.error("[TokenList] Failed to fetch token list:", error);
    await loadCacheFromStorage();
    return tokenList;
  }
}

export async function getTokenByMint(mint: string): Promise<TokenInfo | null> {
  await loadCacheFromStorage();
  
  const cached = tokenCache.get(mint);
  if (cached) return cached;
  
  if (tokenList.length < 100) {
    await fetchTokenList();
    return tokenCache.get(mint) || null;
  }
  
  return null;
}

export async function searchTokens(query: string, limit: number = 20): Promise<TokenInfo[]> {
  await loadCacheFromStorage();
  
  if (tokenList.length < 100) {
    await fetchTokenList();
  }
  
  const q = query.toLowerCase().trim();
  if (!q) return getPopularTokens();
  
  const exactMint = tokenList.find(t => t.mint.toLowerCase() === q);
  if (exactMint) return [exactMint];
  
  const results = tokenList
    .filter(t => 
      t.symbol.toLowerCase().includes(q) || 
      t.name.toLowerCase().includes(q) ||
      t.mint.toLowerCase().startsWith(q)
    )
    .sort((a, b) => {
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
  return POPULAR_TOKENS;
}

export async function initTokenList(): Promise<void> {
  await loadCacheFromStorage();
  
  if (tokenList.length < 100) {
    fetchTokenList().catch(console.error);
  }
}

export function getTokenLogoUri(mint: string): string | undefined {
  const token = tokenCache.get(mint);
  return token?.logoURI;
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
