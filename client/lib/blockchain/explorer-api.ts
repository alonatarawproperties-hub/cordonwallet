import { getChainById, supportedChains, ChainConfig } from "./chains";
import { TxRecord, ActivityType } from "@/lib/transaction-history";
import { getApiUrl } from "@/lib/query-client";

interface ExplorerTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  isError: string;
  contractAddress?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
}

interface ExplorerResponse {
  status: string;
  message: string;
  result: ExplorerTransaction[] | string;
}

function formatAmount(value: string, decimals: number): string {
  const num = BigInt(value);
  const divisor = BigInt(10 ** decimals);
  const whole = num / divisor;
  const fraction = num % divisor;
  
  if (fraction === BigInt(0)) {
    return whole.toString();
  }
  
  const fractionStr = fraction.toString().padStart(decimals, "0");
  const trimmed = fractionStr.replace(/0+$/, "");
  
  if (trimmed.length > 6) {
    return `${whole}.${trimmed.slice(0, 6)}`;
  }
  
  return `${whole}.${trimmed}`;
}

async function enrichTransactionsWithPrices(transactions: TxRecord[]): Promise<TxRecord[]> {
  if (transactions.length === 0) return transactions;
  
  try {
    const apiUrl = getApiUrl();
    const url = new URL("/api/enrich-transactions", apiUrl);
    
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions }),
    });
    
    if (!response.ok) {
      console.log("[ExplorerAPI] Failed to enrich transactions, using original");
      return transactions;
    }
    
    const data = await response.json();
    console.log("[ExplorerAPI] Enriched transactions with prices");
    return data.transactions || transactions;
  } catch (error) {
    console.error("[ExplorerAPI] Error enriching transactions:", error);
    return transactions;
  }
}

export async function fetchTransactionHistory(
  walletAddress: string,
  chainId: number
): Promise<TxRecord[]> {
  const chain = getChainById(chainId);
  if (!chain) {
    console.log(`[ExplorerAPI] No chain config for chainId ${chainId}`);
    return [];
  }

  try {
    const apiUrl = getApiUrl();
    
    if (chainId === 0) {
      const url = new URL(`/api/solana/history/${walletAddress}`, apiUrl);
      url.searchParams.set("limit", "50");
      
      console.log(`[ExplorerAPI] Fetching Solana transactions for:`, walletAddress);
      
      const response = await fetch(url.toString());
      if (!response.ok) {
        console.error(`[ExplorerAPI] Solana history error:`, response.status);
        return [];
      }
      
      const data = await response.json();
      
      if (!Array.isArray(data) || data.length === 0) {
        console.log(`[ExplorerAPI] Solana no transactions found`);
        return [];
      }
      
      console.log(`[ExplorerAPI] Solana found ${data.length} transactions`);
      
      const transactions: TxRecord[] = data.map((tx: any): TxRecord => ({
        id: tx.signature,
        chainId: 0,
        walletAddress,
        hash: tx.signature,
        type: tx.tokenMint ? "spl" : "native",
        activityType: tx.type === "receive" ? "receive" : tx.type === "send" ? "send" : "send",
        tokenSymbol: tx.tokenSymbol || "SOL",
        to: tx.to || "",
        from: tx.from || "",
        amount: tx.amount?.toString() || "0",
        status: tx.err ? "failed" : "confirmed",
        createdAt: tx.blockTime ? tx.blockTime * 1000 : Date.now(),
        explorerUrl: `https://solscan.io/tx/${tx.signature}`,
      }));
      
      return transactions;
    }
    
    const url = new URL(`/api/transactions/${walletAddress}/all`, apiUrl);
    url.searchParams.set("chainId", chainId.toString());
    
    console.log(`[ExplorerAPI] Fetching all transactions for ${chain.name}:`, walletAddress);
    
    const response = await fetch(url.toString());
    const data = await response.json();

    console.log(`[ExplorerAPI] ${chain.name} response status:`, data.status, data.message);

    if (data.status !== "1" || !Array.isArray(data.result)) {
      console.log(`[ExplorerAPI] ${chain.name} no transactions or error:`, data.result);
      return [];
    }
    
    console.log(`[ExplorerAPI] ${chain.name} found ${data.result.length} transactions`);

    const transactions: TxRecord[] = data.result
      .filter((tx: any) => {
        if (tx.txType === "token") return true;
        return tx.value !== "0" || tx.to.toLowerCase() === walletAddress.toLowerCase();
      })
      .map((tx: any): TxRecord => {
        const isReceive = tx.to.toLowerCase() === walletAddress.toLowerCase();
        const activityType: ActivityType = isReceive ? "receive" : "send";
        const isTokenTx = tx.txType === "token";

        return {
          id: `${tx.hash}-${tx.timeStamp}`,
          chainId,
          walletAddress,
          hash: tx.hash,
          type: isTokenTx ? "erc20" : "native",
          activityType,
          tokenSymbol: isTokenTx ? (tx.tokenSymbol || "TOKEN") : chain.nativeSymbol,
          tokenAddress: isTokenTx ? tx.contractAddress : undefined,
          to: tx.to,
          from: tx.from,
          amount: formatAmount(tx.value, isTokenTx ? parseInt(tx.tokenDecimal || "18") : chain.nativeDecimals),
          status: tx.isError === "0" ? "confirmed" : "failed",
          createdAt: parseInt(tx.timeStamp) * 1000,
          explorerUrl: `${chain.explorerBaseUrl}/tx/${tx.hash}`,
        };
      });

    const enrichedTransactions = await enrichTransactionsWithPrices(transactions);
    return enrichedTransactions;
  } catch (error) {
    console.error(`Failed to fetch transactions for chain ${chainId}:`, error);
    return [];
  }
}

export async function fetchAllChainsHistory(
  walletAddress: string
): Promise<TxRecord[]> {
  const results = await Promise.all(
    supportedChains.map((chain) =>
      fetchTransactionHistory(walletAddress, chain.chainId)
    )
  );

  const allTransactions = results.flat();
  allTransactions.sort((a, b) => b.createdAt - a.createdAt);

  return allTransactions.slice(0, 100);
}

export function groupTransactionsByDate(
  transactions: TxRecord[]
): { title: string; data: TxRecord[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const thisWeekStart = new Date(today.getTime() - today.getDay() * 24 * 60 * 60 * 1000);
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const groups: Record<string, TxRecord[]> = {};

  for (const tx of transactions) {
    const txDate = new Date(tx.createdAt);
    let groupKey: string;

    if (txDate >= today) {
      groupKey = "Today";
    } else if (txDate >= yesterday) {
      groupKey = "Yesterday";
    } else if (txDate >= thisWeekStart) {
      groupKey = "This Week";
    } else if (txDate >= lastWeekStart) {
      groupKey = "Last Week";
    } else {
      groupKey = txDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }

    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(tx);
  }

  const orderedKeys = ["Today", "Yesterday", "This Week", "Last Week"];
  const result: { title: string; data: TxRecord[] }[] = [];

  for (const key of orderedKeys) {
    if (groups[key]) {
      result.push({ title: key, data: groups[key] });
      delete groups[key];
    }
  }

  const monthKeys = Object.keys(groups).sort((a, b) => {
    const dateA = new Date(groups[a][0].createdAt);
    const dateB = new Date(groups[b][0].createdAt);
    return dateB.getTime() - dateA.getTime();
  });

  for (const key of monthKeys) {
    result.push({ title: key, data: groups[key] });
  }

  return result;
}
