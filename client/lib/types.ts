export type NetworkId = "ethereum" | "polygon" | "bsc" | "solana";
export type ChainType = "evm" | "solana";

export interface Network {
  id: NetworkId;
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  nativeSymbol: string;
  color: string;
}

export interface Token {
  symbol: string;
  name: string;
  decimals: number;
  address?: string;
  logoUrl?: string;
  isNative: boolean;
}

export interface TokenBalance {
  token: Token;
  balance: string;
  balanceUsd: string;
}

export interface MultiChainAddresses {
  evm: `0x${string}`;
  solana: string;
}

export interface Wallet {
  id: string;
  name: string;
  address: string;
  addresses?: MultiChainAddresses;
  createdAt: number;
}

export interface Bundle {
  id: string;
  name: string;
  walletIds: string[];
  createdAt: number;
}

export interface Transaction {
  hash: string;
  type: "send" | "receive" | "approve" | "swap" | "contract";
  status: "pending" | "success" | "failed";
  from: string;
  to: string;
  value: string;
  tokenSymbol: string;
  networkId: NetworkId;
  chainType?: ChainType;
  timestamp: number;
  gasUsed?: string;
  gasFee?: string;
}

export interface Approval {
  id: string;
  tokenSymbol: string;
  tokenAddress: string;
  spenderAddress: string;
  spenderName?: string;
  allowance: string;
  isUnlimited: boolean;
  networkId: NetworkId;
  createdAt: number;
}

export interface PolicySettings {
  blockUnlimitedApprovals: boolean;
  maxSpendPerTransaction: string;
  dailySpendLimit: string;
  allowlistedAddresses: string[];
  denylistedAddresses: string[];
}

export interface FirewallPreview {
  actionType: "Transfer" | "Approve" | "Swap" | "Contract Interaction";
  youPay?: { amount: string; symbol: string };
  youReceive?: { amount: string; symbol: string };
  destination?: string;
  spender?: string;
  approvalAmount?: string;
  isUnlimitedApproval?: boolean;
  gasFee: string;
  riskLevel: "Low" | "Medium" | "High";
  riskReasons: string[];
  policyResult: "Allowed" | "Blocked";
  policyReason?: string;
}

export const NETWORKS: Record<NetworkId, Network> = {
  ethereum: {
    id: "ethereum",
    name: "Ethereum",
    chainId: 1,
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    nativeSymbol: "ETH",
    color: "#627EEA",
  },
  polygon: {
    id: "polygon",
    name: "Polygon",
    chainId: 137,
    rpcUrl: "https://polygon.llamarpc.com",
    explorerUrl: "https://polygonscan.com",
    nativeSymbol: "MATIC",
    color: "#8247E5",
  },
  bsc: {
    id: "bsc",
    name: "BNB Chain",
    chainId: 56,
    rpcUrl: "https://bsc-dataseed.binance.org",
    explorerUrl: "https://bscscan.com",
    nativeSymbol: "BNB",
    color: "#F0B90B",
  },
  solana: {
    id: "solana",
    name: "Solana",
    chainId: 0,
    rpcUrl: "https://api.mainnet-beta.solana.com",
    explorerUrl: "https://solscan.io",
    nativeSymbol: "SOL",
    color: "#9945FF",
  },
};

export function getChainType(networkId: NetworkId): ChainType {
  return networkId === "solana" ? "solana" : "evm";
}
