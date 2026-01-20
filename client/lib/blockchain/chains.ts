import { Chain, mainnet, polygon, bsc, arbitrum, sepolia, polygonAmoy, bscTestnet } from "viem/chains";

export interface ChainConfig {
  chainId: number;
  name: string;
  nativeSymbol: string;
  nativeDecimals: number;
  rpcUrl: string;
  explorerBaseUrl: string;
  iconName: string;
  viemChain: Chain;
  isTestnet: boolean;
}

const USE_TESTNETS = process.env.EXPO_PUBLIC_USE_TESTNETS === "true";

const MAINNET_CHAINS: ChainConfig[] = [
  {
    chainId: 1,
    name: "Ethereum",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    rpcUrl: process.env.EXPO_PUBLIC_ETH_RPC_URL || "https://ethereum-rpc.publicnode.com",
    explorerBaseUrl: "https://etherscan.io",
    iconName: "ethereum",
    viemChain: mainnet,
    isTestnet: false,
  },
  {
    chainId: 137,
    name: "Polygon",
    nativeSymbol: "POL",
    nativeDecimals: 18,
    rpcUrl: process.env.EXPO_PUBLIC_POLYGON_RPC_URL || "https://polygon-bor-rpc.publicnode.com",
    explorerBaseUrl: "https://polygonscan.com",
    iconName: "polygon",
    viemChain: polygon,
    isTestnet: false,
  },
  {
    chainId: 56,
    name: "BNB Chain",
    nativeSymbol: "BNB",
    nativeDecimals: 18,
    rpcUrl: process.env.EXPO_PUBLIC_BSC_RPC_URL || "https://bsc-rpc.publicnode.com",
    explorerBaseUrl: "https://bscscan.com",
    iconName: "bnb",
    viemChain: bsc,
    isTestnet: false,
  },
  {
    chainId: 42161,
    name: "Arbitrum",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    rpcUrl: process.env.EXPO_PUBLIC_ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
    explorerBaseUrl: "https://arbiscan.io",
    iconName: "arbitrum",
    viemChain: arbitrum,
    isTestnet: false,
  },
];

const TESTNET_CHAINS: ChainConfig[] = [
  {
    chainId: 11155111,
    name: "Sepolia",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    rpcUrl: process.env.EXPO_PUBLIC_SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
    explorerBaseUrl: "https://sepolia.etherscan.io",
    iconName: "ethereum",
    viemChain: sepolia,
    isTestnet: true,
  },
  {
    chainId: 80002,
    name: "Polygon Amoy",
    nativeSymbol: "POL",
    nativeDecimals: 18,
    rpcUrl: process.env.EXPO_PUBLIC_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
    explorerBaseUrl: "https://amoy.polygonscan.com",
    iconName: "polygon",
    viemChain: polygonAmoy,
    isTestnet: true,
  },
  {
    chainId: 97,
    name: "BSC Testnet",
    nativeSymbol: "tBNB",
    nativeDecimals: 18,
    rpcUrl: process.env.EXPO_PUBLIC_BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545",
    explorerBaseUrl: "https://testnet.bscscan.com",
    iconName: "bnb",
    viemChain: bscTestnet,
    isTestnet: true,
  },
];

export const supportedChains: ChainConfig[] = USE_TESTNETS ? TESTNET_CHAINS : MAINNET_CHAINS;

export function getChainById(chainId: number): ChainConfig | undefined {
  return supportedChains.find((c) => c.chainId === chainId);
}

export function getDefaultChain(): ChainConfig {
  return supportedChains[0];
}

export function getExplorerAddressUrl(chainId: number, address: string): string {
  const chain = getChainById(chainId);
  if (!chain) return "";
  return `${chain.explorerBaseUrl}/address/${address}`;
}

export function getExplorerTxUrl(chainId: number, txHash: string): string {
  const chain = getChainById(chainId);
  if (!chain) return "";
  return `${chain.explorerBaseUrl}/tx/${txHash}`;
}
