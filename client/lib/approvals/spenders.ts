interface KnownSpender {
  address: `0x${string}`;
  label: string;
  protocol: string;
  trusted: boolean;
}

const KNOWN_SPENDERS: Record<number, KnownSpender[]> = {
  1: [
    { address: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", label: "Uniswap Router", protocol: "Uniswap", trusted: true },
    { address: "0xE592427A0AEce92De3Edee1F18E0157C05861564", label: "Uniswap V3 Router", protocol: "Uniswap", trusted: true },
    { address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", label: "Uniswap V2 Router", protocol: "Uniswap", trusted: true },
    { address: "0x1111111254EEB25477B68fb85Ed929f73A960582", label: "1inch Router", protocol: "1inch", trusted: true },
    { address: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF", label: "0x Exchange Proxy", protocol: "0x", trusted: true },
    { address: "0x881D40237659C251811CEC9c364ef91dC08D300C", label: "MetaMask Swap Router", protocol: "MetaMask", trusted: true },
  ],
  137: [
    { address: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", label: "Uniswap Router", protocol: "Uniswap", trusted: true },
    { address: "0xE592427A0AEce92De3Edee1F18E0157C05861564", label: "Uniswap V3 Router", protocol: "Uniswap", trusted: true },
    { address: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", label: "QuickSwap Router", protocol: "QuickSwap", trusted: true },
    { address: "0x1111111254EEB25477B68fb85Ed929f73A960582", label: "1inch Router", protocol: "1inch", trusted: true },
    { address: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF", label: "0x Exchange Proxy", protocol: "0x", trusted: true },
  ],
  56: [
    { address: "0x10ED43C718714eb63d5aA57B78B54704E256024E", label: "PancakeSwap Router", protocol: "PancakeSwap", trusted: true },
    { address: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4", label: "PancakeSwap Smart Router", protocol: "PancakeSwap", trusted: true },
    { address: "0x1111111254EEB25477B68fb85Ed929f73A960582", label: "1inch Router", protocol: "1inch", trusted: true },
    { address: "0xDef1C0ded9bec7F1a1670819833240f027b25EfF", label: "0x Exchange Proxy", protocol: "0x", trusted: true },
  ],
};

export function getSpenderLabel(chainId: number, spender: `0x${string}`): string | undefined {
  const spenders = KNOWN_SPENDERS[chainId];
  if (!spenders) return undefined;
  
  const found = spenders.find(
    s => s.address.toLowerCase() === spender.toLowerCase()
  );
  
  return found?.label;
}

export function isKnownSpender(chainId: number, spender: `0x${string}`): boolean {
  const spenders = KNOWN_SPENDERS[chainId];
  if (!spenders) return false;
  
  return spenders.some(s => s.address.toLowerCase() === spender.toLowerCase());
}

export function isTrustedSpender(chainId: number, spender: `0x${string}`): boolean {
  const spenders = KNOWN_SPENDERS[chainId];
  if (!spenders) return false;
  
  const found = spenders.find(
    s => s.address.toLowerCase() === spender.toLowerCase()
  );
  
  return found?.trusted ?? false;
}

export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
