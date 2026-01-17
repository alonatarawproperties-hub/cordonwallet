export const RPC_PRIMARY = process.env.EXPO_PUBLIC_SOLANA_RPC_HELIUS || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
export const WS_PRIMARY = process.env.EXPO_PUBLIC_SOLANA_WS_HELIUS || "";
export const RPC_FALLBACK = process.env.EXPO_PUBLIC_SOLANA_RPC_TRITON || "https://api.mainnet-beta.solana.com";
export const WS_FALLBACK = process.env.EXPO_PUBLIC_SOLANA_WS_TRITON || "";
export const JUPITER_API_URLS = [
  process.env.EXPO_PUBLIC_JUPITER_API_URL || "https://quote-api.jup.ag",
  "https://api.jup.ag",
];
export const JUPITER_API_URL = JUPITER_API_URLS[0];

export const STANDARD_CAP_SOL = 0.0008;
export const FAST_CAP_SOL = 0.002;
export const TURBO_CAP_SOL = 0.005;
export const ADV_MAX_CAP_SOL = 0.02;

export type SwapSpeed = "standard" | "fast" | "turbo";

export const SPEED_CONFIGS: Record<SwapSpeed, {
  label: string;
  description: string;
  capSol: number;
  rebroadcastIntervalMs: number;
  maxRebroadcastDurationMs: number;
  rebuildPrompts: number;
  completionLevel: "confirmed" | "processed";
}> = {
  standard: {
    label: "Standard",
    description: "Lower fees, normal speed",
    capSol: STANDARD_CAP_SOL,
    rebroadcastIntervalMs: 1200,
    maxRebroadcastDurationMs: 6000,
    rebuildPrompts: 1,
    completionLevel: "confirmed",
  },
  fast: {
    label: "Fast",
    description: "Higher priority, faster landing",
    capSol: FAST_CAP_SOL,
    rebroadcastIntervalMs: 1000,
    maxRebroadcastDurationMs: 12000,
    rebuildPrompts: 2,
    completionLevel: "processed",
  },
  turbo: {
    label: "Turbo",
    description: "Maximum priority for congested launches",
    capSol: TURBO_CAP_SOL,
    rebroadcastIntervalMs: 800,
    maxRebroadcastDurationMs: 20000,
    rebuildPrompts: 3,
    completionLevel: "processed",
  },
};

export const LAMPORTS_PER_SOL = 1_000_000_000;

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export const POPULAR_TOKENS = [
  { mint: SOL_MINT, symbol: "SOL", name: "Solana", decimals: 9, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" },
  { mint: USDC_MINT, symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png" },
  { mint: USDT_MINT, symbol: "USDT", name: "Tether USD", decimals: 6, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png" },
];

export const JUPITER_PROGRAM_IDS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",
  "JUP3c2Uh3WA4Ng34tw6kPd2G4C5BB21Xo36Je1s32Ph",
  "JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX",
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY",
  "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu",
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",
  "2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c",
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",
]);

export const PUMP_PROGRAM_IDS = new Set([
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  "FAdo9NCwGJpCdqL6yUdNmvR4hXC9Mnjuix8k2HyCqDc8",
  "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg",
]);

export const ALLOWED_PROGRAM_IDS = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  ...JUPITER_PROGRAM_IDS,
  ...PUMP_PROGRAM_IDS,
]);

export const DEFAULT_SLIPPAGE_BPS = 200; // 2% default like Trust Wallet
export const MAX_SLIPPAGE_BPS = 5000; // 50% max
export const SLIPPAGE_PRESETS = [10, 50, 100, 250]; // 0.1%, 0.5%, 1%, 2.5%
export const SLIPPAGE_STEP = 10; // 0.1% increment

export const QUOTE_DEBOUNCE_MS = 500;

export const QUOTE_REFRESH_INTERVALS: Record<SwapSpeed, number> = {
  standard: 12000,
  fast: 6000,
  turbo: 2500,
};

export const QUOTE_REFRESH_INTERVAL_MS = QUOTE_REFRESH_INTERVALS.standard;
