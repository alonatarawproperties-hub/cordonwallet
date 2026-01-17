export const CORDON_TREASURY_WALLET = "6pcN26cpKbWmGyRn8DgRjqRzpBW2CFp8PK5wZ9gTArpE";
export const CORDON_SUCCESS_FEE_BPS = 50; // 0.50%

export const swapConfig = {
  solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  solanaRpcUrlFallback: process.env.SOLANA_RPC_URL_FALLBACK || "https://api.mainnet-beta.solana.com",
  
  jupiterBaseUrl: process.env.JUPITER_BASE_URL || "https://lite-api.jup.ag",
  jupiterQuotePath: process.env.JUPITER_QUOTE_PATH || "/swap/v1/quote",
  jupiterSwapPath: process.env.JUPITER_SWAP_PATH || "/swap/v1/swap",
  jupiterTimeoutMs: parseInt(process.env.JUPITER_TIMEOUT_MS || "8000"),
  
  tokenListPrimary: process.env.SWAP_TOKENLIST_PRIMARY || "https://token.jup.ag/strict",
  tokenListFallback: process.env.SWAP_TOKENLIST_FALLBACK || "https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json",
  tokenListTtlMs: parseInt(process.env.TOKENLIST_TTL_MS || "21600000"),
  
  pumpModeEnabled: process.env.PUMP_MODE_ENABLED !== "false",
  pumpPortalBaseUrl: process.env.PUMPPORTAL_BASE_URL || "https://pumpportal.fun",
  pumpPortalApiKey: process.env.PUMPPORTAL_API_KEY || "",
  
  maxBodyBytes: parseInt(process.env.MAX_BODY_BYTES || "2000000"),
  
  priorityFeeCaps: {
    standard: 200_000,
    fast: 1_000_000,
    turbo: 3_000_000,
  },
  maxPriorityFeeCap: 10_000_000,
  
  broadcastRetries: {
    standard: { maxRetries: 2, timeoutMs: 6000 },
    fast: { maxRetries: 4, timeoutMs: 12000 },
    turbo: { maxRetries: 6, timeoutMs: 20000 },
  },
};

export type SpeedMode = "standard" | "fast" | "turbo";

export function getPriorityFeeCap(speedMode: SpeedMode, override?: number): number {
  const baseCap = swapConfig.priorityFeeCaps[speedMode];
  if (override !== undefined) {
    return Math.min(override, swapConfig.maxPriorityFeeCap);
  }
  return baseCap;
}
