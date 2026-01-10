import AsyncStorage from "@react-native-async-storage/async-storage";

const HIDDEN_TOKENS_KEY = "cordon_hidden_tokens";
const CUSTOM_TOKENS_KEY = "cordon_custom_tokens";
const SOLANA_PORTFOLIO_CACHE_PREFIX = "@cordon/solana_portfolio_v1_";

let customTokenVersion = 0;
export function getCustomTokenVersion(): number {
  return customTokenVersion;
}

export function buildCustomTokenMap(customTokens: CustomToken[]): Map<string, CustomToken> {
  const map = new Map<string, CustomToken>();
  const solanaTokens = customTokens.filter(
    ct => ct.chainId === 0 || (ct.chainId as any) === "solana"
  );
  solanaTokens.forEach(ct => {
    map.set(ct.contractAddress.toLowerCase(), ct);
  });
  return map;
}

export function applyCustomTokenMetadata<T extends { mint?: string; symbol: string; name: string; logoUrl?: string }>(
  asset: T,
  customTokenMap: Map<string, CustomToken>
): T {
  if (!asset.mint) return asset;
  const customToken = customTokenMap.get(asset.mint.toLowerCase());
  if (customToken) {
    return {
      ...asset,
      symbol: customToken.symbol,
      name: customToken.name,
      logoUrl: customToken.logoUrl,
    };
  }
  return asset;
}

async function clearSolanaPortfolioCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const solanaKeys = keys.filter(k => k.startsWith(SOLANA_PORTFOLIO_CACHE_PREFIX));
    if (solanaKeys.length > 0) {
      await AsyncStorage.multiRemove(solanaKeys);
      console.log("[TokenPrefs] Cleared Solana portfolio cache");
    }
  } catch (e) {
    console.log("[TokenPrefs] Failed to clear Solana cache:", e);
  }
}

export interface CustomToken {
  chainId: number;
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
}

export interface TokenPreferences {
  hiddenTokens: string[];
  customTokens: CustomToken[];
}

function getTokenKey(chainId: number, symbol: string): string {
  return `${chainId}:${symbol}`;
}

export async function getHiddenTokens(): Promise<string[]> {
  try {
    const data = await AsyncStorage.getItem(HIDDEN_TOKENS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function setHiddenTokens(tokens: string[]): Promise<void> {
  await AsyncStorage.setItem(HIDDEN_TOKENS_KEY, JSON.stringify(tokens));
}

export async function hideToken(chainId: number, symbol: string): Promise<void> {
  const hidden = await getHiddenTokens();
  const key = getTokenKey(chainId, symbol);
  if (!hidden.includes(key)) {
    hidden.push(key);
    await setHiddenTokens(hidden);
  }
}

export async function showToken(chainId: number, symbol: string): Promise<void> {
  const hidden = await getHiddenTokens();
  const key = getTokenKey(chainId, symbol);
  const filtered = hidden.filter(k => k !== key);
  await setHiddenTokens(filtered);
}

export async function isTokenHidden(chainId: number, symbol: string): Promise<boolean> {
  const hidden = await getHiddenTokens();
  return hidden.includes(getTokenKey(chainId, symbol));
}

export async function getCustomTokens(): Promise<CustomToken[]> {
  try {
    const data = await AsyncStorage.getItem(CUSTOM_TOKENS_KEY);
    console.log("[TokenPrefs] Raw custom tokens data:", data);
    if (!data) return [];
    const tokens = JSON.parse(data) as CustomToken[];
    // Normalize Solana chainId: convert "solana" string to 0
    const normalizedTokens = tokens.map(t => ({
      ...t,
      chainId: (t.chainId as any) === "solana" ? 0 : t.chainId,
    }));
    console.log("[TokenPrefs] Parsed tokens:", JSON.stringify(normalizedTokens));
    return normalizedTokens;
  } catch (e) {
    console.log("[TokenPrefs] Error loading custom tokens:", e);
    return [];
  }
}

export async function addCustomToken(token: CustomToken): Promise<void> {
  const normalizedToken: CustomToken = {
    ...token,
    chainId: (token.chainId as any) === "solana" ? 0 : token.chainId,
    contractAddress: token.contractAddress.toLowerCase(),
  };
  console.log("[TokenPrefs] addCustomToken called with normalized:", JSON.stringify(normalizedToken));
  
  const tokens = await getCustomTokens();
  console.log("[TokenPrefs] Existing tokens before add:", JSON.stringify(tokens));
  
  const existingIndex = tokens.findIndex(
    t => t.chainId === normalizedToken.chainId && 
         t.contractAddress.toLowerCase() === normalizedToken.contractAddress.toLowerCase()
  );
  
  if (existingIndex === -1) {
    tokens.push(normalizedToken);
    const dataToSave = JSON.stringify(tokens);
    console.log("[TokenPrefs] Saving tokens:", dataToSave);
    await AsyncStorage.setItem(CUSTOM_TOKENS_KEY, dataToSave);
    console.log("[TokenPrefs] Token saved successfully");
  } else {
    tokens[existingIndex] = {
      ...tokens[existingIndex],
      symbol: normalizedToken.symbol,
      name: normalizedToken.name,
      logoUrl: normalizedToken.logoUrl,
    };
    await AsyncStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(tokens));
    console.log("[TokenPrefs] Updated existing token metadata");
  }
  
  customTokenVersion++;
  if (normalizedToken.chainId === 0) {
    await clearSolanaPortfolioCache();
  }
}

export async function removeCustomToken(chainId: number, contractAddress: string): Promise<void> {
  const normalizedChainId = (chainId as any) === "solana" ? 0 : chainId;
  const tokens = await getCustomTokens();
  const filtered = tokens.filter(
    t => !(t.chainId === normalizedChainId && t.contractAddress.toLowerCase() === contractAddress.toLowerCase())
  );
  await AsyncStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(filtered));
  
  customTokenVersion++;
  if (normalizedChainId === 0) {
    await clearSolanaPortfolioCache();
  }
}

export async function getTokenPreferences(): Promise<TokenPreferences> {
  const [hiddenTokens, customTokens] = await Promise.all([
    getHiddenTokens(),
    getCustomTokens(),
  ]);
  return { hiddenTokens, customTokens };
}
