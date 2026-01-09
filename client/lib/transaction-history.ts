import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@cordon/transaction_history";
const MAX_TRANSACTIONS = 100;

export interface TxRecord {
  id: string;
  chainId: number;
  walletAddress: string;
  hash: string;
  type: "native" | "erc20";
  tokenAddress?: string;
  tokenSymbol: string;
  to: string;
  amount: string;
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
