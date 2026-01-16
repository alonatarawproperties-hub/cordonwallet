interface BackoffConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}

const DEFAULT_CONFIG: BackoffConfig = {
  maxRetries: 3,
  baseDelayMs: 300,
  maxDelayMs: 5000,
  jitterMs: 200,
};

interface FetchResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
  retryAfter?: number;
}

function calculateDelay(attempt: number, config: BackoffConfig, retryAfter?: number): number {
  if (retryAfter) {
    return Math.min(retryAfter * 1000, config.maxDelayMs);
  }
  
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * config.jitterMs;
  return Math.min(exponentialDelay + jitter, config.maxDelayMs);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export async function fetchWithBackoff<T>(
  url: string,
  options: RequestInit = {},
  config: Partial<BackoffConfig> = {}
): Promise<FetchResult<T>> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError: string = "Unknown error";
  let lastStatus: number = 0;
  
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      lastStatus = response.status;
      
      if (response.ok) {
        const data = await response.json();
        return { ok: true, data, status: response.status };
      }
      
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
      
      if (isRetryableStatus(response.status) && attempt < cfg.maxRetries) {
        const delay = calculateDelay(attempt, cfg, retryAfter);
        console.log(`[FetchBackoff] Retry ${attempt + 1}/${cfg.maxRetries} after ${delay}ms (status: ${response.status})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      const errorText = await response.text().catch(() => "Unknown error");
      lastError = errorText;
      
      return {
        ok: false,
        error: lastError,
        status: response.status,
        retryAfter,
      };
    } catch (error: any) {
      lastError = error.message || "Fetch failed";
      
      if (error.name === "AbortError") {
        lastError = "Request timeout";
      }
      
      if (attempt < cfg.maxRetries) {
        const delay = calculateDelay(attempt, cfg);
        console.log(`[FetchBackoff] Retry ${attempt + 1}/${cfg.maxRetries} after ${delay}ms (error: ${lastError})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }
  }
  
  return {
    ok: false,
    error: lastError,
    status: lastStatus || 503,
  };
}

export class UpstreamBusyError extends Error {
  status = 503;
  code = "UPSTREAM_BUSY";
  
  constructor(message: string = "Network busy, try again.") {
    super(message);
    this.name = "UpstreamBusyError";
  }
}

export function createUpstreamError(message?: string): UpstreamBusyError {
  return new UpstreamBusyError(message);
}
