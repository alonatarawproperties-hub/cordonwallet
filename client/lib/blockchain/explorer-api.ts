import { getChainById, supportedChains, ChainConfig } from "./chains";
import { TxRecord, ActivityType } from "@/lib/transaction-history";

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

function getExplorerApiUrl(chain: ChainConfig): string {
  switch (chain.chainId) {
    case 1:
      return "https://api.etherscan.io/api";
    case 137:
      return "https://api.polygonscan.com/api";
    case 56:
      return "https://api.bscscan.com/api";
    case 11155111:
      return "https://api-sepolia.etherscan.io/api";
    case 80002:
      return "https://api-amoy.polygonscan.com/api";
    case 97:
      return "https://api-testnet.bscscan.com/api";
    default:
      return "";
  }
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

export async function fetchTransactionHistory(
  walletAddress: string,
  chainId: number
): Promise<TxRecord[]> {
  const chain = getChainById(chainId);
  if (!chain) return [];

  const apiUrl = getExplorerApiUrl(chain);
  if (!apiUrl) return [];

  try {
    const response = await fetch(
      `${apiUrl}?module=account&action=txlist&address=${walletAddress}&startblock=0&endblock=99999999&page=1&offset=50&sort=desc`
    );

    const data: ExplorerResponse = await response.json();

    if (data.status !== "1" || !Array.isArray(data.result)) {
      return [];
    }

    const transactions: TxRecord[] = data.result
      .filter((tx) => tx.value !== "0" || tx.to.toLowerCase() === walletAddress.toLowerCase())
      .map((tx): TxRecord => {
        const isReceive = tx.to.toLowerCase() === walletAddress.toLowerCase();
        const activityType: ActivityType = isReceive ? "receive" : "send";

        return {
          id: `${tx.hash}-${tx.timeStamp}`,
          chainId,
          walletAddress,
          hash: tx.hash,
          type: "native",
          activityType,
          tokenSymbol: chain.nativeSymbol,
          to: tx.to,
          from: tx.from,
          amount: formatAmount(tx.value, chain.nativeDecimals),
          status: tx.isError === "0" ? "confirmed" : "failed",
          createdAt: parseInt(tx.timeStamp) * 1000,
          explorerUrl: `${chain.explorerBaseUrl}/tx/${tx.hash}`,
        };
      });

    return transactions;
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
