export interface DApp {
  id: string;
  name: string;
  category: "DEX" | "Lending" | "NFT" | "Bridge" | "Aggregator" | "Gaming" | "Social" | "Other";
  url: string;
  iconUrl?: string;
  chains: ("evm" | "solana")[];
  description?: string;
}

export const POPULAR_DAPPS: DApp[] = [
  {
    id: "roachy-games",
    name: "Roachy Games",
    category: "Gaming",
    url: "https://roachygames.io",
    iconUrl: "https://roachygames.io/favicon.ico",
    chains: ["solana"],
    description: "Play-to-earn Solana games",
  },
  {
    id: "uniswap",
    name: "Uniswap",
    category: "DEX",
    url: "https://app.uniswap.org",
    iconUrl: "https://app.uniswap.org/favicon.ico",
    chains: ["evm"],
    description: "Leading decentralized exchange",
  },
  {
    id: "aave",
    name: "Aave",
    category: "Lending",
    url: "https://app.aave.com",
    iconUrl: "https://app.aave.com/favicon.ico",
    chains: ["evm"],
    description: "DeFi lending protocol",
  },
  {
    id: "opensea",
    name: "OpenSea",
    category: "NFT",
    url: "https://opensea.io",
    iconUrl: "https://opensea.io/favicon.ico",
    chains: ["evm"],
    description: "NFT marketplace",
  },
  {
    id: "1inch",
    name: "1inch",
    category: "Aggregator",
    url: "https://app.1inch.io",
    iconUrl: "https://app.1inch.io/favicon.ico",
    chains: ["evm"],
    description: "DEX aggregator",
  },
  {
    id: "curve",
    name: "Curve",
    category: "DEX",
    url: "https://curve.fi",
    iconUrl: "https://curve.fi/favicon.ico",
    chains: ["evm"],
    description: "Stablecoin DEX",
  },
  {
    id: "compound",
    name: "Compound",
    category: "Lending",
    url: "https://compound.finance",
    iconUrl: "https://compound.finance/favicon.ico",
    chains: ["evm"],
    description: "DeFi lending protocol",
  },
  {
    id: "pancakeswap",
    name: "PancakeSwap",
    category: "DEX",
    url: "https://pancakeswap.finance",
    iconUrl: "https://pancakeswap.finance/favicon.ico",
    chains: ["evm"],
    description: "BNB Chain DEX",
  },
  {
    id: "jupiter",
    name: "Jupiter",
    category: "Aggregator",
    url: "https://jup.ag",
    iconUrl: "https://jup.ag/favicon.ico",
    chains: ["solana"],
    description: "Solana DEX aggregator",
  },
  {
    id: "raydium",
    name: "Raydium",
    category: "DEX",
    url: "https://raydium.io",
    iconUrl: "https://raydium.io/favicon.ico",
    chains: ["solana"],
    description: "Solana AMM",
  },
  {
    id: "magic-eden",
    name: "Magic Eden",
    category: "NFT",
    url: "https://magiceden.io",
    iconUrl: "https://magiceden.io/favicon.ico",
    chains: ["solana", "evm"],
    description: "Multi-chain NFT marketplace",
  },
  {
    id: "lido",
    name: "Lido",
    category: "Other",
    url: "https://lido.fi",
    iconUrl: "https://lido.fi/favicon.ico",
    chains: ["evm"],
    description: "Liquid staking",
  },
  {
    id: "blur",
    name: "Blur",
    category: "NFT",
    url: "https://blur.io",
    iconUrl: "https://blur.io/favicon.ico",
    chains: ["evm"],
    description: "NFT marketplace for traders",
  },
];

export const DAPP_CATEGORIES = [
  { id: "all", label: "All" },
  { id: "DEX", label: "DEX" },
  { id: "Lending", label: "Lending" },
  { id: "NFT", label: "NFT" },
  { id: "Aggregator", label: "Aggregator" },
  { id: "Bridge", label: "Bridge" },
  { id: "Gaming", label: "Gaming" },
  { id: "Other", label: "Other" },
] as const;

export function getDAppsByCategory(category: string): DApp[] {
  if (category === "all") return POPULAR_DAPPS;
  return POPULAR_DAPPS.filter((dapp) => dapp.category === category);
}

export function searchDApps(query: string): DApp[] {
  const lowerQuery = query.toLowerCase();
  return POPULAR_DAPPS.filter(
    (dapp) =>
      dapp.name.toLowerCase().includes(lowerQuery) ||
      dapp.url.toLowerCase().includes(lowerQuery) ||
      dapp.category.toLowerCase().includes(lowerQuery)
  );
}
