import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPublicClient } from "@/lib/blockchain/client";

const STORAGE_KEY = "@cordon/transaction_history";
const MAX_TRANSACTIONS = 100;

export type ActivityType = "send" | "receive" | "swap";

export interface TxRecord {
  id: string;
  chainId: number;
  walletAddress: string;
  hash: string;
  type: "native" | "erc20";
  activityType: ActivityType;
  tokenAddress?: string;
  tokenSymbol: string;
  to: string;
  from?: string;
  amount: string;
  toTokenSymbol?: string;
  toAmount?: string;
  priceUsd?: number;
  status: "pending" | "confirmed" | "failed";
  createdAt: number;
  explorerUrl: string;
}

export async function saveTransaction(tx: Omit<TxRecord, "id" | "createdAt" | "status">): Promise<TxRecord> {
  const record: TxRecord = {
    ...tx,
    id: `${tx.hash}-${Date.now()}`,
    status: "pending",
    createdAt: Date.now(),
  };

  const existing = await getTransactionHistory();
  const updated = [record, ...existing].slice(0, MAX_TRANSACTIONS);
  
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  
  return record;
}

export async function updateTransactionStatus(
  hash: string,
  status: TxRecord["status"]
): Promise<void> {
  const existing = await getTransactionHistory();
  const updated = existing.map((tx) =>
    tx.hash === hash ? { ...tx, status } : tx
  );
  
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export async function getTransactionHistory(): Promise<TxRecord[]> {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
    return [];
  } catch {
    return [];
  }
}

export async function getTransactionsByWallet(walletAddress: string): Promise<TxRecord[]> {
  const all = await getTransactionHistory();
  return all.filter(
    (tx) => tx.walletAddress.toLowerCase() === walletAddress.toLowerCase()
  );
}

export async function getTransactionsByChain(
  walletAddress: string,
  chainId: number
): Promise<TxRecord[]> {
  const all = await getTransactionHistory();
  return all.filter(
    (tx) =>
      tx.walletAddress.toLowerCase() === walletAddress.toLowerCase() &&
      tx.chainId === chainId
  );
}

export async function clearTransactionHistory(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function pollPendingTransactions(): Promise<{ updated: number }> {
  const transactions = await getTransactionHistory();
  const pending = transactions.filter((tx) => tx.status === "pending");
  
  if (pending.length === 0) {
    return { updated: 0 };
  }

  let updatedCount = 0;
  
  for (const tx of pending) {
    try {
      const publicClient = getPublicClient(tx.chainId);
      const receipt = await publicClient.getTransactionReceipt({
        hash: tx.hash as `0x${string}`,
      });
      
      if (receipt) {
        const newStatus = receipt.status === "success" ? "confirmed" : "failed";
        await updateTransactionStatus(tx.hash, newStatus);
        updatedCount++;
      }
    } catch (error) {
      // Transaction not yet mined or RPC error - skip
      continue;
    }
  }
  
  return { updated: updatedCount };
}

export function formatTransactionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}
