/**
 * Chain configuration - Solana only for Phase I
 */

export interface ChainConfig {
  chainId: number;
  name: string;
  nativeSymbol: string;
  nativeDecimals: number;
  rpcUrl: string;
  explorerBaseUrl: string;
  iconName: string;
  isTestnet: boolean;
}

export const supportedChains: ChainConfig[] = [
  {
    chainId: 0,
    name: "Solana",
    nativeSymbol: "SOL",
    nativeDecimals: 9,
    rpcUrl: process.env.EXPO_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    explorerBaseUrl: "https://solscan.io",
    iconName: "solana",
    isTestnet: false,
  },
];

export function getChainById(chainId: number): ChainConfig | undefined {
  return supportedChains.find((c) => c.chainId === chainId);
}

export function getDefaultChain(): ChainConfig {
  return supportedChains[0];
}

export function getExplorerAddressUrl(chainId: number, address: string): string {
  if (chainId === 0) return `https://solscan.io/account/${address}`;
  return "";
}

export function getExplorerTxUrl(chainId: number, txHash: string): string {
  if (chainId === 0) return `https://solscan.io/tx/${txHash}`;
  return "";
}
