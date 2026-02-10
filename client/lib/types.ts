export type NetworkId = "solana";
export type ChainType = "solana";

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

export type WalletType = "multi-chain" | "solana-only";

export interface Wallet {
  id: string;
  name: string;
  address: string;
  addresses?: MultiChainAddresses;
  walletType?: WalletType;
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

export interface PolicySettings {
  blockUnlimitedApprovals: boolean;
  maxSpendPerTransaction: string;
  dailySpendLimit: string;
  allowlistedAddresses: string[];
  denylistedAddresses: string[];
}

export const NETWORKS: Record<NetworkId, Network> = {
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
  return "solana";
}
