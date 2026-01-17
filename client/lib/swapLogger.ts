const isDev = __DEV__;

type LogLevel = "debug" | "info" | "warn" | "error";

const TRANSIENT_ERROR_PATTERNS = [
  /429/i,
  /rate.?limit/i,
  /too many requests/i,
  /temporarily unavailable/i,
  /503/i,
  /UPSTREAM_BUSY/i,
  /network busy/i,
  /timeout/i,
  /fetch failed/i,
];

function isTransientError(message: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

function formatMessage(tag: string, message: string, data?: any): string {
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  return `[${tag}] ${message}${dataStr}`;
}

export const swapLogger = {
  debug(tag: string, message: string, data?: any): void {
    if (isDev) {
      console.log(formatMessage(tag, message, data));
    }
  },

  info(tag: string, message: string, data?: any): void {
    console.log(formatMessage(tag, message, data));
  },

  warn(tag: string, message: string, data?: any): void {
    const msg = formatMessage(tag, message, data);
    if (isTransientError(message) || (data && isTransientError(String(data)))) {
      if (isDev) {
        console.log(`[TRANSIENT] ${msg}`);
      }
    } else {
      console.warn(msg);
    }
  },

  error(tag: string, message: string, data?: any): void {
    const msg = formatMessage(tag, message, data);
    const errorStr = data?.message || data?.error || String(data) || message;
    
    if (isTransientError(errorStr)) {
      if (isDev) {
        console.log(`[TRANSIENT] ${msg}`);
      }
    } else {
      console.error(msg);
    }
  },

  transient(tag: string, message: string, data?: any): void {
    if (isDev) {
      console.log(formatMessage(tag, `[transient] ${message}`, data));
    }
  },
};

export function isRetryableError(status: number): boolean {
  return status === 429 || status === 503 || status >= 500;
}

export function getUserFriendlyErrorMessage(error: any): string {
  const msg = error?.message || String(error);
  const status = error?.status || error?.statusCode;
  
  // API route not deployed (404 on the endpoint itself)
  if (/swap api not deployed|404.*api.*swap/i.test(msg) || (status === 404 && /api.*swap/i.test(msg))) {
    return "Swap service unavailable. Please try again later.";
  }
  // Jupiter unreachable from backend
  if (/jupiter.*unreachable|jupiter.*blocked|jupiter.*down/i.test(msg)) {
    return "Swap routing provider (Jupiter) unreachable. Try again shortly.";
  }
  if (/429|rate.?limit|too many requests/i.test(msg)) {
    return "Rate limited — retrying...";
  }
  if (/503|UPSTREAM_BUSY/i.test(msg)) {
    return "Service temporarily unavailable, retrying...";
  }
  if (status >= 500 || /5\d{2}/.test(msg)) {
    return `Backend error (${status || "5xx"}). Please try again.`;
  }
  if (/timeout|timed out/i.test(msg)) {
    return "Request timed out, retrying...";
  }
  if (/no route|no swap routes/i.test(msg)) {
    return "No route found for this swap pair.";
  }
  if (/network|fetch failed|connection|cannot reach/i.test(msg)) {
    return "Network issue, please check your connection.";
  }
  
  return msg;
}

export interface SwapHealthStatus {
  ok: boolean;
  rpcOk: boolean;
  jupiterOk: boolean;
  jupiterError?: string;
}

export function parseSwapHealthResponse(data: any): SwapHealthStatus {
  const services = data?.services || {};
  const rpcOk = services.rpc?.ok === true;
  const jupiterOk = services.jupiter?.ok === true;
  
  let jupiterError: string | undefined;
  if (!jupiterOk && services.jupiter?.error) {
    const err = services.jupiter.error;
    jupiterError = err.causeMessage || err.message || "Unknown error";
  }

  return {
    ok: data?.ok === true,
    rpcOk,
    jupiterOk,
    jupiterError,
  };
}

export function getJupiterDownMessage(health: SwapHealthStatus): string | null {
  if (health.rpcOk && !health.jupiterOk) {
    return `Swap routing provider unreachable from backend (Jupiter). ${health.jupiterError ? `Reason: ${health.jupiterError}` : "Try again or switch endpoint."}`;
  }
  return null;
}

export function shouldSuppressLogBox(error: any): boolean {
  const msg = error?.message || String(error);
  return isTransientError(msg);
}
