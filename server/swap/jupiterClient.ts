const DEFAULT_LITE_BASE_URL = "https://lite-api.jup.ag";
const DEFAULT_PRO_BASE_URL = "https://api.jup.ag";

const TIMEOUT_MS = Number(process.env.JUPITER_TIMEOUT_MS) || 10000;
const MAX_RETRIES = Number(process.env.JUPITER_MAX_RETRIES) || 2;
const RETRY_DELAYS = [250, 500, 1000];

const JUP_API_KEY = process.env.JUP_API_KEY || process.env.JUPITER_API_KEY || "";

let rateLimitUntil = 0;

export interface JupiterPingResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  baseUrlUsed: string;
  error?: {
    message: string;
    name: string;
    code?: string;
    errno?: number;
    causeMessage?: string;
    stackShort?: string;
  };
}

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
}

export interface JupiterQuoteResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  baseUrlUsed: string;
  data?: any;
  error?: JupiterPingResult["error"];
}

function getBaseUrls(): string[] {
  const envPrimary = process.env.JUPITER_BASE_URL?.trim() || "";
  const envFallbacksRaw = process.env.JUPITER_FALLBACK_URLS || "";
  const envFallbacks = envFallbacksRaw
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);

  let candidates: string[];
  if (JUP_API_KEY) {
    candidates = [DEFAULT_PRO_BASE_URL, DEFAULT_LITE_BASE_URL, envPrimary, ...envFallbacks];
  } else {
    candidates = [DEFAULT_LITE_BASE_URL, DEFAULT_PRO_BASE_URL, envPrimary, ...envFallbacks];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of candidates) {
    const normalized = url.replace(/\/+$/, "");
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function isProEndpoint(baseUrl: string): boolean {
  return baseUrl === DEFAULT_PRO_BASE_URL || baseUrl.includes("api.jup.ag");
}

function extractErrorDetails(err: any): JupiterPingResult["error"] {
  const cause = err.cause as any;
  return {
    message: err.message || String(err),
    name: err.name || "Error",
    code: err.code || cause?.code,
    errno: err.errno || cause?.errno,
    causeMessage: cause?.message,
    stackShort: err.stack?.split("\n").slice(0, 2).join(" | "),
  };
}

function isRetryableError(err: any, status?: number): boolean {
  const retryableCodes = ["EAI_AGAIN", "ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"];
  const retryableStatuses = [429, 500, 502, 503, 504];

  if (err?.code && retryableCodes.includes(err.code)) return true;
  if (err?.cause?.code && retryableCodes.includes(err.cause.code)) return true;
  if (err?.name === "TypeError" && String(err.message).includes("fetch failed")) return true;
  if (status && retryableStatuses.includes(status)) return true;

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getHeaders(baseUrl: string, method: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Cordon-Wallet/1.0",
  };

  if (method === "POST") {
    headers["Content-Type"] = "application/json";
  }

  if (JUP_API_KEY) {
    headers["x-api-key"] = JUP_API_KEY;
  }

  return headers;
}

interface JupiterRequestOptions {
  method: "GET" | "POST";
  body?: string;
}

interface JupiterRequestResult {
  ok: boolean;
  status?: number;
  data?: any;
  baseUrlUsed: string;
  latencyMs: number;
  error?: JupiterPingResult["error"];
}

async function jupiterRequest(
  path: string,
  options: JupiterRequestOptions
): Promise<JupiterRequestResult> {
  const baseUrls = getBaseUrls();
  let lastError: any = null;
  let lastBaseUrl = baseUrls[0] || DEFAULT_LITE_BASE_URL;

  for (const baseUrl of baseUrls) {
    lastBaseUrl = baseUrl;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const now = Date.now();

      if (now < rateLimitUntil && attempt === 0) {
        const waitMs = Math.max(rateLimitUntil - now, 2000);
        await sleep(waitMs);
      }

      const url = `${baseUrl}${path}`;
      const start = Date.now();

      try {
        const response = await fetchWithTimeout(url, {
          method: options.method,
          headers: getHeaders(baseUrl, options.method),
          body: options.body,
        });

        const latencyMs = Date.now() - start;

        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const waitSec = retryAfter ? parseInt(retryAfter, 10) : 2;
          rateLimitUntil = Date.now() + waitSec * 1000;
          console.log(`[Jupiter] 429 rate limited, waiting ${waitSec}s`, { baseUrl, path });

          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAYS[attempt] || 1000);
            continue;
          }
          break;
        }

        if (response.ok) {
          const data = await response.json();
          return { ok: true, status: response.status, data, baseUrlUsed: baseUrl, latencyMs };
        }

        if (isRetryableError(null, response.status) && attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAYS[attempt] || 500);
          continue;
        }

        const errorData = await response.json().catch(() => ({}));
        return {
          ok: false,
          status: response.status,
          data: errorData,
          baseUrlUsed: baseUrl,
          latencyMs,
          error: { message: errorData.error || `HTTP ${response.status}`, name: "HTTPError" },
        };
      } catch (err: any) {
        lastError = err;
        const latencyMs = Date.now() - start;

        if (isRetryableError(err) && attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAYS[attempt] || 500);
          continue;
        }

        console.log("[Jupiter] request failed", {
          path,
          baseUrl,
          code: err.code || err.cause?.code,
          message: err.message?.slice(0, 60),
        });

        break;
      }
    }
  }

  return {
    ok: false,
    baseUrlUsed: lastBaseUrl,
    latencyMs: 0,
    error: lastError ? extractErrorDetails(lastError) : { message: "All endpoints failed", name: "JupiterError" },
  };
}

export async function jupiterQuotePing(): Promise<JupiterPingResult> {
  const testPath =
    "/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000&slippageBps=50";

  const start = Date.now();
  const result = await jupiterRequest(testPath, { method: "GET" });

  return {
    ok: result.ok,
    status: result.status,
    latencyMs: Date.now() - start,
    baseUrlUsed: result.baseUrlUsed,
    error: result.error,
  };
}

export async function jupiterQuote(params: JupiterQuoteParams): Promise<JupiterQuoteResult> {
  const queryParams = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    slippageBps: String(params.slippageBps || 50),
  });

  const path = `/swap/v1/quote?${queryParams.toString()}`;
  const start = Date.now();
  const result = await jupiterRequest(path, { method: "GET" });

  return {
    ok: result.ok,
    status: result.status,
    latencyMs: Date.now() - start,
    baseUrlUsed: result.baseUrlUsed,
    data: result.data,
    error: result.error,
  };
}

export async function jupiterSwapTransaction(
  quoteResponse: any,
  userPublicKey: string,
  options?: {
    prioritizationFeeLamports?: number;
    wrapAndUnwrapSol?: boolean;
  }
): Promise<JupiterQuoteResult> {
  const path = "/swap/v1/swap";
  const body = JSON.stringify({
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol: options?.wrapAndUnwrapSol ?? true,
    prioritizationFeeLamports: options?.prioritizationFeeLamports,
  });

  const start = Date.now();
  const result = await jupiterRequest(path, { method: "POST", body });

  return {
    ok: result.ok,
    status: result.status,
    latencyMs: Date.now() - start,
    baseUrlUsed: result.baseUrlUsed,
    data: result.data,
    error: result.error,
  };
}

export function getConfiguredBaseUrls(): string[] {
  return getBaseUrls();
}

export function hasApiKey(): boolean {
  return JUP_API_KEY.length > 0;
}
