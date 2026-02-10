import AsyncStorage from "@react-native-async-storage/async-storage";

import { getCordonSolTreasury } from "@/constants/treasury";

const STORAGE_KEY = "@cordon/transaction_history";
const MAX_TRANSACTIONS = 100;

// Filter out transactions sent to the Cordon treasury (success fees)
export function filterTreasuryTransactions(transactions: TxRecord[]): TxRecord[] {
  const treasuryAddress = getCordonSolTreasury();
  if (!treasuryAddress) return transactions;
  
  const treasuryLower = treasuryAddress.toLowerCase();
  return transactions.filter(tx => {
    // Only filter out sends to treasury
    if (tx.activityType !== "send") return true;
    return tx.to.toLowerCase() !== treasuryLower;
  });
}

export type ActivityType = "send" | "receive" | "swap";

export interface SwapInfo {
  fromAmount: string;
  fromSymbol: string;
  toAmount: string;
  toSymbol: string;
}

export interface TxRecord {
  id: string;
  chainId: number;
  walletAddress: string;
  hash: string;
  type: "native" | "erc20" | "spl" | "swap" | "transfer";
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
  swapInfo?: SwapInfo;
}

export async function saveTransaction(
  tx: Omit<TxRecord, "id" | "createdAt" | "status"> & { status?: TxRecord["status"] }
): Promise<TxRecord> {
  const record: TxRecord = {
    ...tx,
    id: `${tx.hash}-${Date.now()}`,
    status: tx.status || "pending",
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

export async function clearSolanaTransactions(): Promise<number> {
  const existing = await getTransactionHistory();
  const filtered = existing.filter((tx) => tx.chainId !== 0);
  const removed = existing.length - filtered.length;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  console.log(`[TxHistory] Cleared ${removed} Solana transactions`);
  return removed;
}

export async function pollPendingTransactions(): Promise<{ updated: number }> {
  // EVM polling removed for Phase I (Solana-only)
  return { updated: 0 };
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
