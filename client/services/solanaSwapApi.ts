import { getApiUrl, getApiHeaders } from "@/lib/query-client";

export type SpeedMode = "standard" | "fast" | "turbo";

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  swapMode?: "ExactIn" | "ExactOut";
}

export interface QuoteResult {
  ok: boolean;
  route?: "jupiter";
  quote?: any;
  normalized?: {
    outAmount: string;
    minOut: string;
    priceImpactPct: number;
    routePlan: any[];
  };
  code?: string;
  message?: string;
}

export interface PumpMeta {
  isPump: boolean;
  isBondingCurve: boolean;
  isGraduated: boolean;
  mint: string;
  updatedAt: number;
}

export interface RouteQuoteResult {
  ok: boolean;
  route: "jupiter" | "pump" | "none";
  quoteResponse?: any;
  pumpMeta?: PumpMeta;
  normalized?: {
    outAmount: string;
    minOut: string;
    priceImpactPct: number;
    routePlan: any[];
  };
  reason?: string;
  message?: string;
}

export interface BuildJupiterParams {
  userPublicKey: string;
  quote: any;
  speedMode?: SpeedMode;
  maxPriorityFeeLamports?: number;
  wrapAndUnwrapSol?: boolean;
}

export interface BuildPumpParams {
  userPublicKey: string;
  mint: string;
  side: "buy" | "sell";
  amountSol?: number;
  amountTokens?: number;
  slippageBps?: number;
  speedMode?: SpeedMode;
  maxPriorityFeeLamports?: number;
}

export interface BuildResult {
  ok: boolean;
  route?: "jupiter" | "pump";
  swapTransactionBase64?: string;
  lastValidBlockHeight?: number;
  prioritizationFeeLamports?: number;
  code?: string;
  message?: string;
}

export interface SendParams {
  signedTransactionBase64: string;
  mode?: SpeedMode;
}

export interface SendResult {
  ok: boolean;
  signature?: string;
  rpc?: string;
  code?: string;
  message?: string;
}

export interface StatusResult {
  ok: boolean;
  confirmed?: boolean;
  finalized?: boolean;
  error?: string;
}

const BASE_PATH = "/api/swap";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = getApiUrl();
  const url = `${baseUrl}${BASE_PATH}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: getApiHeaders({
        "Content-Type": "application/json",
        ...(options?.headers as Record<string, string>),
      }),
    });
  } catch (fetchErr: any) {
    // Network error — server unreachable
    throw new Error(`Network error: ${fetchErr.message || "Cannot reach server"}`);
  }

  // Guard against non-JSON responses (HTML error pages, 404s, etc.)
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    throw new Error(
      response.status === 404
        ? `API endpoint unavailable: ${path} (404)`
        : `Server error ${response.status}: ${text.slice(0, 120)}`
    );
  }

  const data = await response.json();
  return data;
}

export async function searchTokens(query: string = "", limit: number = 50): Promise<TokenInfo[]> {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  params.set("limit", limit.toString());
  
  const result = await apiFetch<{ ok: boolean; tokens?: TokenInfo[]; error?: string }>(
    `/solana/tokens?${params.toString()}`
  );
  
  return result.tokens || [];
}

export async function getToken(mint: string): Promise<TokenInfo | null> {
  const result = await apiFetch<{ ok: boolean; token?: TokenInfo }>(`/solana/token/${mint}`);
  return result.token || null;
}

export async function quote(params: QuoteParams): Promise<QuoteResult> {
  const queryParams = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
  });
  
  if (params.slippageBps !== undefined) {
    queryParams.set("slippageBps", params.slippageBps.toString());
  }
  if (params.swapMode) {
    queryParams.set("swapMode", params.swapMode);
  }
  
  return apiFetch<QuoteResult>(`/solana/quote?${queryParams.toString()}`);
}

export async function buildJupiter(params: BuildJupiterParams): Promise<BuildResult> {
  return apiFetch<BuildResult>("/solana/build", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function buildPump(params: BuildPumpParams): Promise<BuildResult> {
  return apiFetch<BuildResult>("/solana/pump/build", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function sendSignedTx(params: SendParams): Promise<SendResult> {
  return apiFetch<SendResult>("/solana/send", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function getStatus(signature: string): Promise<StatusResult> {
  return apiFetch<StatusResult>(`/solana/status?sig=${signature}`);
}

export async function isPumpToken(mint: string): Promise<boolean> {
  const result = await apiFetch<{ ok: boolean; isPump: boolean }>(`/solana/is-pump?mint=${mint}`);
  return result.isPump || false;
}

export async function routeQuote(params: QuoteParams): Promise<RouteQuoteResult> {
  const queryParams = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
  });
  
  if (params.slippageBps !== undefined) {
    queryParams.set("slippageBps", params.slippageBps.toString());
  }
  
  return apiFetch<RouteQuoteResult>(`/solana/route-quote?${queryParams.toString()}`);
}

export async function getPumpMeta(mint: string): Promise<PumpMeta | null> {
  try {
    const result = await apiFetch<{ ok: boolean } & Partial<PumpMeta>>(`/solana/pump-meta/${mint}`);
    if (result.ok && result.isPump !== undefined) {
      return result as PumpMeta;
    }
    return null;
  } catch {
    return null;
  }
}

export const SOL_MINT = "So11111111111111111111111111111111111111112";

export const PRIORITY_FEE_CAPS = {
  standard: 500_000,
  fast: 2_000_000,
  turbo: 5_000_000,
} as const;

export function getPriorityFeeDisplay(speedMode: SpeedMode): string {
  const lamports = PRIORITY_FEE_CAPS[speedMode];
  const sol = lamports / 1_000_000_000;
  return `${sol.toFixed(6)} SOL`;
}

// ── Instant Swap API (TG-bot style: single round-trip) ──

export interface InstantBuildParams {
  userPublicKey: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  speedMode?: SpeedMode;
}

export interface InstantBuildResult {
  ok: boolean;
  route?: "jupiter" | "pump";
  swapTransactionBase64?: string;
  quote?: {
    inAmount: string;
    outAmount: string;
    minOut: string;
    priceImpactPct: number;
    routeLabel: string;
  };
  prioritizationFeeLamports?: number;
  lastValidBlockHeight?: number;
  code?: string;
  message?: string;
}

export interface InstantSendParams {
  signedTransactionBase64: string;
  speedMode?: SpeedMode;
}

export interface InstantSendResult {
  ok: boolean;
  signature?: string;
  sentVia?: string[];
  code?: string;
  message?: string;
}

export async function instantBuild(params: InstantBuildParams): Promise<InstantBuildResult> {
  return apiFetch<InstantBuildResult>("/solana/instant-build", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function instantSend(params: InstantSendParams): Promise<InstantSendResult> {
  return apiFetch<InstantSendResult>("/solana/instant-send", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
