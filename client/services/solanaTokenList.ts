import AsyncStorage from "@react-native-async-storage/async-storage";
import { POPULAR_TOKENS } from "@/constants/solanaSwap";
import { getApiUrl } from "@/lib/query-client";

const TOKEN_LIST_KEY = "solana_token_list_v2";
const TOKEN_LIST_TTL_MS = 6 * 60 * 60 * 1000;

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
    if (!tokenList.find(x => x.mint === t.mint)) {
      tokenList.push(t);
    }
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
    const baseUrl = getApiUrl();
    const url = `${baseUrl}/api/swap/solana/tokens?limit=250`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Token list fetch failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.ok || !data.tokens) {
      throw new Error("Invalid response format");
    }
    
    tokenList = data.tokens.map((t: any) => ({
      mint: t.mint,
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
  
  try {
    const baseUrl = getApiUrl();
    const response = await fetch(`${baseUrl}/api/swap/solana/token/${mint}`);
    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.token) {
        tokenCache.set(mint, data.token);
        return data.token;
      }
    }
  } catch (err) {
    console.warn("[TokenList] Failed to fetch token by mint:", err);
  }
  
  try {
    const baseUrl = getApiUrl();
    const response = await fetch(`${baseUrl}/api/solana/token-metadata/${mint}`);
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
    console.warn("[TokenList] Failed to fetch token metadata:", err);
  }
  
  return null;
}

export async function searchTokens(query: string, limit: number = 20): Promise<TokenInfo[]> {
  await loadCacheFromStorage();
  
  const q = query.toLowerCase().trim();
  if (!q) return getPopularTokens();
  
  try {
    const baseUrl = getApiUrl();
    const params = new URLSearchParams({ query: q, limit: limit.toString() });
    const response = await fetch(`${baseUrl}/api/swap/solana/tokens?${params.toString()}`);
    
    if (response.ok) {
      const data = await response.json();
      if (data.ok && data.tokens && data.tokens.length > 0) {
        return data.tokens;
      }
    }
  } catch (err) {
    console.warn("[TokenList] Server search failed, using local cache:", err);
  }
  
  const exactMint = tokenList.find(t => t.mint.toLowerCase() === q);
  if (exactMint) return [exactMint];
  
  if (q.length >= 32 && q.length <= 44) {
    const token = await getTokenByMint(q);
    if (token) return [token];
  }
  
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
