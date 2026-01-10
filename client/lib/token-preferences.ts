import AsyncStorage from "@react-native-async-storage/async-storage";

const HIDDEN_TOKENS_KEY = "cordon_hidden_tokens";
const CUSTOM_TOKENS_KEY = "cordon_custom_tokens";

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
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function addCustomToken(token: CustomToken): Promise<void> {
  const tokens = await getCustomTokens();
  const exists = tokens.some(
    t => t.chainId === token.chainId && 
         t.contractAddress.toLowerCase() === token.contractAddress.toLowerCase()
  );
  if (!exists) {
    tokens.push(token);
    await AsyncStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(tokens));
  }
}

export async function removeCustomToken(chainId: number, contractAddress: string): Promise<void> {
  const tokens = await getCustomTokens();
  const filtered = tokens.filter(
    t => !(t.chainId === chainId && t.contractAddress.toLowerCase() === contractAddress.toLowerCase())
  );
  await AsyncStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(filtered));
}

export async function getTokenPreferences(): Promise<TokenPreferences> {
  const [hiddenTokens, customTokens] = await Promise.all([
    getHiddenTokens(),
    getCustomTokens(),
  ]);
  return { hiddenTokens, customTokens };
}
