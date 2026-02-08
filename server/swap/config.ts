export const CORDON_TREASURY_WALLET = "J23SHFtAW79DRKxGFeogFYCXi3oNRBDFfJKss1dfaNi2";
export const CORDON_SUCCESS_FEE_BPS = 50; // 0.50%

export const platformFeeConfig = {
  // Enabled by default - uses treasury wallet ATAs as fee accounts (no referral program needed)
  enabled: process.env.CORDON_PLATFORM_FEE_ENABLED !== "false",
  feeBps: parseInt(process.env.CORDON_PLATFORM_FEE_BPS || "50", 10),

  // Manual overrides: mint -> ATA address. Auto-resolved if not specified.
  knownFeeAccounts: {} as Record<string, string>,
};

export function isPlatformFeeEnabled(): boolean {
  return platformFeeConfig.enabled &&
         platformFeeConfig.feeBps > 0 &&
         CORDON_TREASURY_WALLET.length > 0;
}

// Build Helius RPC URL from API key if SOLANA_RPC_URL isn't explicitly set
function resolveRpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  return "https://api.mainnet-beta.solana.com";
}

const resolvedRpc = resolveRpcUrl();
console.log(`[SwapConfig] RPC: ${resolvedRpc.includes("helius") ? "Helius (paid)" : resolvedRpc.includes("mainnet-beta") ? "PUBLIC mainnet (limited!)" : resolvedRpc.slice(0, 40)}...`);

export const swapConfig = {
  solanaRpcUrl: resolvedRpc,
  solanaRpcUrlFallback: process.env.SOLANA_RPC_URL_FALLBACK || resolvedRpc,
  
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
  
  // Jito block engine for instant landing
  jitoBlockEngineUrl: process.env.JITO_BLOCK_ENGINE_URL || "https://mainnet.block-engine.jito.wtf",

  maxBodyBytes: parseInt(process.env.MAX_BODY_BYTES || "2000000"),
  
  priorityFeeCaps: {
    standard: 500_000,
    fast: 2_000_000,
    turbo: 5_000_000,
  },
  maxPriorityFeeCap: 10_000_000,
  
  broadcastRetries: {
    standard: { maxRetries: 5, timeoutMs: 30000 },
    fast: { maxRetries: 8, timeoutMs: 40000 },
    turbo: { maxRetries: 12, timeoutMs: 50000 },
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
