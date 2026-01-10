import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getSolanaConnection } from "./client";

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

export async function getSolBalance(address: string): Promise<SolBalance> {
  const connection = getSolanaConnection();
  const publicKey = new PublicKey(address);
  const lamports = await connection.getBalance(publicKey);
  
  return {
    lamports,
    sol: (lamports / LAMPORTS_PER_SOL).toFixed(9),
  };
}

export async function getSplTokenBalances(address: string): Promise<SplTokenBalance[]> {
  const connection = getSolanaConnection();
  const publicKey = new PublicKey(address);
  
  try {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
      programId: TOKEN_PROGRAM_ID,
    });
    
    return tokenAccounts.value.map((account) => {
      const parsed = account.account.data.parsed;
      const info = parsed.info;
      const tokenAmount = info.tokenAmount;
      
      return {
        mint: info.mint,
        tokenAccount: account.pubkey.toBase58(),
        amount: tokenAmount.amount,
        decimals: tokenAmount.decimals,
        uiAmount: tokenAmount.uiAmount || 0,
      };
    }).filter((token) => token.uiAmount > 0);
  } catch (error) {
    console.error("Failed to fetch SPL token balances:", error);
    return [];
  }
}

export async function getSolanaPortfolio(address: string): Promise<{
  nativeBalance: SolBalance;
  tokens: SplTokenBalance[];
}> {
  const [nativeBalance, tokens] = await Promise.all([
    getSolBalance(address),
    getSplTokenBalances(address),
  ]);
  
  return {
    nativeBalance,
    tokens,
  };
}
