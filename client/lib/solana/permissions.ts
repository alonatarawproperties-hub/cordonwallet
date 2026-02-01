import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { getApiUrl, getApiHeaders } from "@/lib/query-client";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

export interface TokenDelegate {
  id: string;
  mint: string;
  tokenAccount: string;
  delegate: string;
  delegatedAmount: string;
  tokenSymbol?: string;
  tokenName?: string;
  decimals?: number;
  riskLevel: "medium" | "low";
  riskReason: string;
}

interface RawTokenAccount {
  pubkey: string;
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          owner: string;
          delegate?: string;
          delegatedAmount?: {
            amount: string;
            decimals: number;
            uiAmount: number;
          };
          state: string;
        };
        type: string;
      };
      program: string;
      space: number;
    };
    executable: boolean;
    lamports: number;
    owner: string;
  };
}

interface TokenAccountResponse {
  result: {
    value: RawTokenAccount[];
  };
}

async function fetchTokenAccountsFromServer(owner: string): Promise<RawTokenAccount[]> {
  try {
    const apiUrl = getApiUrl();
    const url = new URL(`/api/solana/token-accounts/${owner}`, apiUrl);
    
    const response = await fetch(url.toString(), { headers: getApiHeaders() });
    if (!response.ok) {
      console.log(`[SolanaPermissions] Server API returned ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    return data.tokenAccounts || [];
  } catch (error) {
    console.error("[SolanaPermissions] Failed to fetch from server:", error);
    return [];
  }
}

export async function fetchSolanaDelegates(owner: string): Promise<TokenDelegate[]> {
  const tokenAccounts = await fetchTokenAccountsFromServer(owner);
  const delegates: TokenDelegate[] = [];
  
  for (const account of tokenAccounts) {
    const info = account.account?.data?.parsed?.info;
    if (!info) continue;
    
    if (info.delegate && info.delegatedAmount) {
      const delegatedAmountBigInt = BigInt(info.delegatedAmount.amount || "0");
      
      if (delegatedAmountBigInt > 0n) {
        const id = `${account.pubkey}-${info.delegate}`;
        
        delegates.push({
          id,
          mint: info.mint,
          tokenAccount: account.pubkey,
          delegate: info.delegate,
          delegatedAmount: info.delegatedAmount.amount,
          decimals: info.delegatedAmount.decimals,
          riskLevel: "medium",
          riskReason: "Token delegate can transfer tokens on your behalf",
        });
      }
    }
  }
  
  return delegates;
}

export async function fetchTokenMetadata(
  mint: string
): Promise<{ symbol: string; name: string; decimals: number } | null> {
  try {
    const apiUrl = getApiUrl();
    const url = new URL(`/api/solana/token-metadata/${mint}`, apiUrl);
    
    const response = await fetch(url.toString(), { headers: getApiHeaders() });
    if (!response.ok) return null;
    
    const data = await response.json();
    return data.metadata || null;
  } catch (error) {
    console.error("[SolanaPermissions] Failed to fetch token metadata:", error);
    return null;
  }
}

export async function revokeSolanaDelegate(
  walletId: string,
  tokenAccountAddress: string
): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    const { getApiUrl, getApiHeaders } = await import("@/lib/query-client");
    const { signSolanaTransaction } = await import("@/lib/blockchain/transactions");

    const apiUrl = getApiUrl();
    const prepareUrl = new URL("/api/solana/prepare-revoke-delegate", apiUrl);

    const prepareResponse = await fetch(prepareUrl.toString(), {
      method: "POST",
      headers: getApiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ tokenAccountAddress }),
    });
    
    if (!prepareResponse.ok) {
      const error = await prepareResponse.json();
      throw new Error(error.error || "Failed to prepare revoke transaction");
    }
    
    const { transaction } = await prepareResponse.json();
    const signedTx = await signSolanaTransaction({ walletId, transaction });
    
    const sendUrl = new URL("/api/solana/send-raw-transaction", apiUrl);
    const sendResponse = await fetch(sendUrl.toString(), {
      method: "POST",
      headers: getApiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ transactionBase64: signedTx }),
    });
    
    if (!sendResponse.ok) {
      const error = await sendResponse.json();
      throw new Error(error.error || "Failed to send revoke transaction");
    }
    
    const { signature } = await sendResponse.json();
    return { success: true, signature };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to revoke delegate";
    return { success: false, error: message };
  }
}

export function computeSolanaPermissionsSummary(
  sessionCount: number,
  delegates: TokenDelegate[]
): {
  connectedDApps: number;
  tokenDelegates: number;
  hasRiskyDelegates: boolean;
} {
  return {
    connectedDApps: sessionCount,
    tokenDelegates: delegates.length,
    hasRiskyDelegates: delegates.some(d => d.riskLevel === "medium"),
  };
}
