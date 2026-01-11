export const DEMO_DAPP = {
  name: "Roachy Games",
  domain: "roachy.games",
  url: "https://roachy.games",
  icon: "https://roachy.games/logo.png",
  verified: true,
};

export const DEMO_SIGN_MESSAGE = `Welcome to Roachy Games!

Click to sign in and accept the Roachy Games Terms of Service (https://roachy.games/tos) and Privacy Policy (https://roachy.games/privacy).

This request will not trigger a blockchain transaction or cost any gas fees.

Wallet address:
0x742d35Cc6634C0532925a3b844Bc9e7595f8F0aB

Nonce: 8f4e2a9c3b7d1e5f`;

export const DEMO_SOLANA_MESSAGE = `Roachy Games wants you to sign in with your Solana account:
7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

Nonce: a3f8c2e1d9b4

Issued At: 2026-01-11T12:00:00.000Z`;

export const DEMO_TRANSACTION = {
  to: "0x1234567890123456789012345678901234567890",
  value: "0.05",
  tokenSymbol: "ETH",
  chainId: 1,
  chainName: "Ethereum",
  gasEstimate: "0.0012 ETH",
  type: "Transfer",
};

export const DEMO_SOLANA_TRANSACTION = {
  programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  type: "SPL Transfer",
  amount: "100",
  tokenSymbol: "USDC",
  recipient: "8xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsV",
  riskLevel: "Low" as const,
  riskReason: "Simple SPL transfer via official Token Program",
};

export const DEMO_APPROVALS = [
  {
    id: "1",
    tokenSymbol: "USDC",
    tokenName: "USD Coin",
    tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    spender: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    spenderLabel: "Uniswap V3 Router",
    allowance: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    isUnlimited: true,
    chainId: 1,
    chainName: "Ethereum",
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 30,
    risk: "high" as const,
    riskReason: "Unlimited approval to swap contract",
  },
  {
    id: "2",
    tokenSymbol: "WETH",
    tokenName: "Wrapped Ether",
    tokenAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    spender: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    spenderLabel: "Uniswap V2 Router",
    allowance: "5000000000000000000",
    isUnlimited: false,
    chainId: 1,
    chainName: "Ethereum",
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 7,
    risk: "medium" as const,
    riskReason: "5 WETH approved",
  },
  {
    id: "3",
    tokenSymbol: "DAI",
    tokenName: "Dai Stablecoin",
    tokenAddress: "0x6b175474e89094c44da98b954eedeac495271d0f",
    spender: "0x1111111254fb6c44bAC0beD2854e76F90643097d",
    spenderLabel: "1inch Router",
    allowance: "1000000000000000000000",
    isUnlimited: false,
    chainId: 1,
    chainName: "Ethereum",
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 90,
    risk: "low" as const,
    riskReason: "1000 DAI - stale approval (90+ days)",
  },
];

export const DEMO_BLOCKED_APPROVAL = {
  tokenSymbol: "USDC",
  tokenName: "USD Coin",
  spender: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  spenderLabel: "Uniswap V3 Router",
  requestedAmount: "Unlimited",
  isBlocked: true,
  reason: "Unlimited approval blocked by Wallet Firewall",
};

export const DEMO_SUCCESS_TX = {
  hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  status: "confirmed" as const,
  type: "Revoke Approval",
  tokenSymbol: "USDC",
  spender: "Uniswap V3 Router",
  timestamp: Date.now(),
};

export type DemoStep = 
  | "connect"
  | "sign_message"
  | "sign_tx_low_risk"
  | "approvals"
  | "revoke"
  | "success";

export const DEMO_STEPS: { key: DemoStep; title: string; description: string }[] = [
  { key: "connect", title: "Connect dApp", description: "Roachy Games connection request" },
  { key: "sign_message", title: "Sign Message", description: "Raw message signing" },
  { key: "sign_tx_low_risk", title: "Sign Transaction", description: "Low Risk transfer with Firewall" },
  { key: "approvals", title: "Approvals", description: "View token approvals" },
  { key: "revoke", title: "Revoke Flow", description: "Revoke confirmation" },
  { key: "success", title: "Success", description: "Transaction confirmed" },
];
