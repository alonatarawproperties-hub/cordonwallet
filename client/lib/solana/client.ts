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
