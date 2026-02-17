/**
 * Explorer API - Solana only for Phase I
 * EVM chain history fetching has been removed.
 */
import { TxRecord } from "@/lib/transaction-history";
import { getApiUrl, getApiHeaders } from "@/lib/query-client";

export async function fetchTransactionHistory(
  walletAddress: string,
  chainId: number
): Promise<TxRecord[]> {
  if (chainId !== 0) return [];

  try {
    const apiUrl = getApiUrl();
    const url = new URL(`/api/solana/history/${walletAddress}`, apiUrl);
    url.searchParams.set("limit", "50");

    const response = await fetch(url.toString(), { headers: getApiHeaders() });
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return [];

    return data
      .filter((tx: any) => tx.type !== "unknown")
      .map((tx: any): TxRecord => ({
        id: tx.signature,
        chainId: 0,
        walletAddress,
        hash: tx.signature,
        type: tx.tokenMint ? "spl" : "native",
        activityType: (tx.type === "receive" || tx.type === "swap") ? tx.type : "send",
        tokenSymbol: tx.tokenSymbol || "SOL",
        to: tx.to || "",
        from: tx.from || "",
        amount: tx.amount?.toString() || "0",
        status: tx.err ? "failed" : "confirmed",
        createdAt: tx.blockTime ? tx.blockTime * 1000 : Date.now(),
        explorerUrl: `https://solscan.io/tx/${tx.signature}`,
      }));
  } catch (error) {
    console.error("[ExplorerAPI] Solana history error:", error);
    return [];
  }
}

export async function fetchAllChainsHistory(
  walletAddress: string
): Promise<TxRecord[]> {
  return fetchTransactionHistory(walletAddress, 0);
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
