import { getApiUrl, getApiHeaders } from "@/lib/query-client";

export interface SolBalance {
  lamports: number;
  sol: string;
}

export interface SplTokenBalance {
  mint: string;
  tokenAccount: string;
  amount: string;
  decimals: number;
  uiAmount: number;
  symbol?: string;
  name?: string;
  logoUrl?: string;
}

export interface SolanaPortfolio {
  nativeBalance: SolBalance;
  tokens: SplTokenBalance[];
}

export async function getSolBalance(address: string): Promise<SolBalance> {
  const apiUrl = getApiUrl();
  const url = new URL(`/api/solana/balance/${address}`, apiUrl);
  const response = await fetch(url.toString(), { headers: getApiHeaders() });

  if (!response.ok) {
    throw new Error("Failed to fetch Solana balance");
  }
  
  return response.json();
}

export async function getSplTokenBalances(address: string): Promise<SplTokenBalance[]> {
  const portfolio = await getSolanaPortfolio(address);
  return portfolio.tokens;
}

export async function getSolanaPortfolio(address: string): Promise<SolanaPortfolio> {
  const apiUrl = getApiUrl();
  const url = new URL(`/api/solana/portfolio/${address}`, apiUrl);
  const response = await fetch(url.toString(), { headers: getApiHeaders() });

  if (!response.ok) {
    throw new Error("Failed to fetch Solana portfolio");
  }
  
  return response.json();
}
