import { Connection, clusterApiUrl } from "@solana/web3.js";

const SOLANA_RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

let connection: Connection | null = null;

export function getSolanaConnection(): Connection {
  if (!connection) {
    connection = new Connection(SOLANA_RPC_URL, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60000,
    });
  }
  return connection;
}

export function resetSolanaConnection(): void {
  connection = null;
}

export const SOLANA_CHAIN_CONFIG = {
  chainKey: "solana",
  name: "Solana",
  nativeSymbol: "SOL",
  nativeDecimals: 9,
  explorerBaseUrl: "https://solscan.io",
  network: "mainnet-beta",
};

export function getSolanaExplorerAddressUrl(address: string): string {
  return `${SOLANA_CHAIN_CONFIG.explorerBaseUrl}/account/${address}`;
}

export function getSolanaExplorerTxUrl(signature: string): string {
  return `${SOLANA_CHAIN_CONFIG.explorerBaseUrl}/tx/${signature}`;
}
