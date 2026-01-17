import http from "http";
import https from "https";

const DEFAULT_BASE_URL = "https://quote-api.jup.ag";
const TIMEOUT_MS = 5000;
const RETRY_DELAYS = [250, 750];

const keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
});

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
  const primary = process.env.JUPITER_BASE_URL || DEFAULT_BASE_URL;
  const fallbacksRaw = process.env.JUPITER_FALLBACK_URLS || "";
  const fallbacks = fallbacksRaw
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  return [primary, ...fallbacks];
}

function extractErrorDetails(err: any): JupiterPingResult["error"] {
  const cause = err.cause as any;
  return {
    message: err.message || String(err),
    name: err.name || "Error",
    code: err.code || cause?.code,
    errno: err.errno || cause?.errno,
    causeMessage: cause?.message,
    stackShort: err.stack?.split("\n").slice(0, 3).join(" | "),
  };
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Cordon-Wallet/1.0",
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function attemptFetch(
  url: string,
  retries: number = 2
): Promise<{ ok: boolean; status?: number; data?: any; error?: any }> {
  let lastError: any = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, TIMEOUT_MS);
      const data = await response.json();
      return { ok: response.ok, status: response.status, data };
    } catch (err: any) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt] || 500));
      }
    }
  }

  return { ok: false, error: lastError };
}

export async function jupiterQuotePing(): Promise<JupiterPingResult> {
  const baseUrls = getBaseUrls();
  const testPath =
    "/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000&slippageBps=50";

  for (const baseUrl of baseUrls) {
    const url = `${baseUrl}${testPath}`;
    const start = Date.now();

    const result = await attemptFetch(url, 2);
    const latencyMs = Date.now() - start;

    if (result.ok) {
      return {
        ok: true,
        status: result.status,
        latencyMs,
        baseUrlUsed: baseUrl,
      };
    }

    if (result.status && result.status < 500) {
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        latencyMs,
        baseUrlUsed: baseUrl,
        error: result.error ? extractErrorDetails(result.error) : undefined,
      };
    }
  }

  const lastBaseUrl = baseUrls[baseUrls.length - 1] || DEFAULT_BASE_URL;
  const start = Date.now();
  const result = await attemptFetch(`${lastBaseUrl}${testPath}`, 0);
  const latencyMs = Date.now() - start;

  return {
    ok: false,
    status: result.status,
    latencyMs,
    baseUrlUsed: lastBaseUrl,
    error: result.error ? extractErrorDetails(result.error) : undefined,
  };
}

export async function jupiterQuote(
  params: JupiterQuoteParams
): Promise<JupiterQuoteResult> {
  const baseUrls = getBaseUrls();
  const queryParams = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    slippageBps: String(params.slippageBps || 50),
  });
  const path = `/v6/quote?${queryParams.toString()}`;

  for (const baseUrl of baseUrls) {
    const url = `${baseUrl}${path}`;
    const start = Date.now();

    const result = await attemptFetch(url, 2);
    const latencyMs = Date.now() - start;

    if (result.ok) {
      return {
        ok: true,
        status: result.status,
        latencyMs,
        baseUrlUsed: baseUrl,
        data: result.data,
      };
    }

    if (result.status && result.status < 500) {
      return {
        ok: false,
        status: result.status,
        latencyMs,
        baseUrlUsed: baseUrl,
        data: result.data,
        error: result.error ? extractErrorDetails(result.error) : undefined,
      };
    }
  }

  const lastBaseUrl = baseUrls[baseUrls.length - 1] || DEFAULT_BASE_URL;
  const start = Date.now();
  const result = await attemptFetch(`${lastBaseUrl}${path}`, 0);

  return {
    ok: false,
    status: result.status,
    latencyMs: Date.now() - start,
    baseUrlUsed: lastBaseUrl,
    data: result.data,
    error: result.error ? extractErrorDetails(result.error) : undefined,
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
  const baseUrls = getBaseUrls();

  for (const baseUrl of baseUrls) {
    const url = `${baseUrl}/v6/swap`;
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS * 2);

      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Cordon-Wallet/1.0",
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey,
          wrapAndUnwrapSol: options?.wrapAndUnwrapSol ?? true,
          prioritizationFeeLamports: options?.prioritizationFeeLamports,
        }),
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;
      const data = await response.json();

      if (response.ok) {
        return { ok: true, status: response.status, latencyMs, baseUrlUsed: baseUrl, data };
      }

      if (response.status < 500) {
        return { ok: false, status: response.status, latencyMs, baseUrlUsed: baseUrl, data };
      }
    } catch (err: any) {
      if (baseUrl === baseUrls[baseUrls.length - 1]) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          baseUrlUsed: baseUrl,
          error: extractErrorDetails(err),
        };
      }
    }
  }

  return {
    ok: false,
    latencyMs: 0,
    baseUrlUsed: baseUrls[0] || DEFAULT_BASE_URL,
    error: { message: "All Jupiter endpoints failed", name: "JupiterError" },
  };
}
