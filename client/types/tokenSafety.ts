export type SafetyLevel = "safe" | "warning" | "danger" | "info";
export type VerificationState = "verified" | "not_verified" | "unavailable";

export interface SafetyProof {
  label: string;
  value: string;
  explorerUrl?: string;
}

export interface SafetyFinding {
  key: string;
  title: string;
  level: SafetyLevel;
  summary: string;
  detail: string;
  verified: VerificationState;
  isHeuristic?: boolean;
  proof?: SafetyProof[];
}

export interface TokenSafetyStats {
  supply?: string;
  decimals?: number;
  topHoldersPct?: number;
  topHoldersCount?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  fdvUsd?: number;
  marketCapUsd?: number;
}

export interface TokenSafetyHeuristics {
  authorityChangedRecently?: boolean;
  deployerOrAuthority?: string;
  suspiciousVolume?: boolean;
  clusteredTopHolders?: boolean;
  notes?: string[];
}

export interface TokenSafetyVerdict {
  label: "Low Risk" | "Medium Risk" | "High Risk";
  level: "safe" | "warning" | "danger";
  reasons: string[];
}

export interface TokenSafetyReportV2 {
  mint: string;
  chain: "solana";
  tokenProgram: "spl" | "token2022" | "unknown";
  scannedAt: number;
  sourceLabel: string;
  findings: SafetyFinding[];
  stats?: TokenSafetyStats;
  heuristics?: TokenSafetyHeuristics;
  verdict: TokenSafetyVerdict;
}

export interface MintCoreInfo {
  decimals: number;
  supply: bigint;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export interface MetadataInfo {
  updateAuthority: string | null;
  isMutable: boolean;
  name?: string;
  symbol?: string;
  uri?: string;
}

export interface TopHoldersResult {
  topPct: number;
  topCount: number;
  largestAccounts: Array<{
    address: string;
    amount: string;
    uiAmount: number;
  }>;
}

export interface DexMarketData {
  pairAddress?: string;
  dexId?: string;
  url?: string;
  liquidityUsd: number;
  volume24hUsd: number;
  fdvUsd?: number;
  marketCapUsd?: number;
  priceUsd?: number;
  priceChange24h?: number;
  baseToken?: { address: string; symbol: string };
  quoteToken?: { address: string; symbol: string };
}
