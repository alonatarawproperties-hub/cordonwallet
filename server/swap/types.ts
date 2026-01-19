import { z } from "zod";

export const SpeedModeSchema = z.enum(["standard", "fast", "turbo"]);

export const QuoteParamsSchema = z.object({
  inputMint: z.string().min(32).max(44),
  outputMint: z.string().min(32).max(44),
  amount: z.string().regex(/^\d+$/),
  slippageBps: z.coerce.number().int().min(0).max(5000).optional().default(50),
  swapMode: z.enum(["ExactIn", "ExactOut"]).optional().default("ExactIn"),
});

export const BuildJupiterBodySchema = z.object({
  userPublicKey: z.string().min(32).max(44),
  quote: z.any(),
  speedMode: SpeedModeSchema.optional().default("standard"),
  maxPriorityFeeLamports: z.number().int().positive().optional(),
  wrapAndUnwrapSol: z.boolean().optional().default(true),
});

export const BuildPumpBodySchema = z.object({
  userPublicKey: z.string().min(32).max(44),
  mint: z.string().min(32).max(44),
  side: z.enum(["buy", "sell"]),
  amountSol: z.number().positive().optional(),
  amountTokens: z.number().positive().optional(),
  slippageBps: z.number().int().min(0).max(5000).optional().default(50),
  speedMode: SpeedModeSchema.optional().default("standard"),
  maxPriorityFeeLamports: z.number().int().positive().optional(),
});

export const SendBodySchema = z.object({
  signedTransactionBase64: z.string().min(100),
  mode: SpeedModeSchema.optional().default("standard"),
});

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  verified?: boolean;
  sources?: string[];
  lastUpdated?: number;
  tags?: string[];
  isCustom?: boolean;
}

export interface QuoteResponse {
  ok: true;
  route: "jupiter";
  quote: any;
  normalized: {
    outAmount: string;
    minOut: string;
    priceImpactPct: number;
    routePlan: any[];
  };
}

export interface QuoteError {
  ok: false;
  code: "NO_ROUTE" | "UPSTREAM" | "BAD_REQUEST" | "TIMEOUT";
  message: string;
  details?: any;
}

export interface BuildResponse {
  ok: true;
  route: "jupiter" | "pump";
  swapTransactionBase64: string;
  lastValidBlockHeight?: number;
  prioritizationFeeLamports: number;
  appliedPlatformFee?: { feeAccount: string; feeBps: number };
  feeDisabledReason?: string;
}

export interface BuildError {
  ok: false;
  code: "BUILD_FAILED" | "UPSTREAM" | "BAD_REQUEST" | "PUMP_UNAVAILABLE" | "TOKEN_GRADUATED";
  message: string;
  details?: any;
  isGraduated?: boolean;
}

export interface SendResponse {
  ok: true;
  signature: string;
  rpc: "primary" | "fallback" | "both";
}

export interface SendError {
  ok: false;
  code: "SEND_FAILED" | "INVALID_TX" | "TIMEOUT";
  message: string;
  details?: any;
}

export type QuoteResult = QuoteResponse | QuoteError;
export type BuildResult = BuildResponse | BuildError;
export type SendResult = SendResponse | SendError;
