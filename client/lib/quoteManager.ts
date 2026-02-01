import { swapLogger, isRetryableError, getUserFriendlyErrorMessage } from "./swapLogger";
import { getApiUrl, getApiHeaders } from "@/lib/query-client";
import type { QuoteRequest, QuoteResponse } from "@/services/jupiter";

const DEBOUNCE_MS = 450;
const QUOTE_CACHE_TTL_MS = 2000;
const MAX_RETRIES = 2;
const RETRY_DELAYS = [300, 800];

interface CachedQuote {
  quote: QuoteResponse;
  timestamp: number;
}

interface InFlightRequest {
  promise: Promise<QuoteResponse>;
  abortController: AbortController;
}

let debounceTimer: NodeJS.Timeout | null = null;
let currentRequest: InFlightRequest | null = null;
const quoteCache = new Map<string, CachedQuote>();
const inFlightKeys = new Set<string>();

function makeQuoteCacheKey(req: QuoteRequest): string {
  return `${req.inputMint}:${req.outputMint}:${req.amount}:${req.slippageBps}`;
}

function getCachedQuote(key: string): QuoteResponse | null {
  const cached = quoteCache.get(key);
  if (cached && Date.now() - cached.timestamp < QUOTE_CACHE_TTL_MS) {
    swapLogger.debug("QuoteManager", "Using cached quote", { key });
    return cached.quote;
  }
  return null;
}

function cacheQuote(key: string, quote: QuoteResponse): void {
  quoteCache.set(key, { quote, timestamp: Date.now() });
  
  if (quoteCache.size > 50) {
    const oldest = Array.from(quoteCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) quoteCache.delete(oldest[0]);
  }
}

async function fetchQuoteWithRetry(
  request: QuoteRequest,
  signal: AbortSignal
): Promise<QuoteResponse> {
  const baseUrl = getApiUrl();
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount,
    slippageBps: request.slippageBps.toString(),
    swapMode: "ExactIn",
  });
  
  if (request.onlyDirectRoutes) {
    params.set("onlyDirectRoutes", "true");
  }
  
  const url = `${baseUrl}/api/jupiter/quote?${params.toString()}`;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal.aborted) {
      throw new Error("Quote request cancelled");
    }
    
    try {
      swapLogger.debug("QuoteManager", `Attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const combinedSignal = signal;
      signal.addEventListener("abort", () => controller.abort());
      
      const response = await fetch(url, {
        method: "GET",
        headers: getApiHeaders({ "Accept": "application/json" }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        
        if (response.status === 400 && JSON.stringify(errorData).includes("No route")) {
          throw new Error("No swap routes found. Try a larger amount or different tokens.");
        }
        
        if (isRetryableError(response.status) && attempt < MAX_RETRIES) {
          swapLogger.transient("QuoteManager", `Retryable error ${response.status}, backing off`);
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] || 500));
          continue;
        }
        
        throw new Error(`Quote failed (${response.status}): ${errorData.error || JSON.stringify(errorData)}`);
      }
      
      const data = await response.json();
      swapLogger.info("QuoteManager", "Quote success", { outAmount: data.outAmount });
      return data;
    } catch (error: any) {
      if (error.name === "AbortError" || signal.aborted) {
        throw new Error("Quote request cancelled");
      }
      
      lastError = error;
      swapLogger.transient("QuoteManager", `Attempt ${attempt + 1} failed: ${error.message}`);
      
      if (error.message?.includes("No swap routes")) {
        throw error;
      }
      
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] || 500));
      }
    }
  }
  
  throw lastError || new Error("Failed to get quote");
}

export function cancelPendingQuote(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  
  if (currentRequest) {
    currentRequest.abortController.abort();
    currentRequest = null;
  }
}

export interface QuoteResult {
  quote: QuoteResponse | null;
  error: string | null;
  isRetrying: boolean;
}

export type QuoteCallback = (result: QuoteResult) => void;

export function requestQuote(
  request: QuoteRequest,
  callback: QuoteCallback
): () => void {
  if (!request.inputMint || !request.outputMint || !request.amount) {
    callback({ quote: null, error: null, isRetrying: false });
    return () => {};
  }
  
  const amount = parseFloat(request.amount);
  if (isNaN(amount) || amount <= 0) {
    callback({ quote: null, error: null, isRetrying: false });
    return () => {};
  }
  
  cancelPendingQuote();
  
  const cacheKey = makeQuoteCacheKey(request);
  
  const cachedQuote = getCachedQuote(cacheKey);
  if (cachedQuote) {
    callback({ quote: cachedQuote, error: null, isRetrying: false });
    return () => {};
  }
  
  if (inFlightKeys.has(cacheKey)) {
    swapLogger.debug("QuoteManager", "Deduped - request already in flight", { cacheKey });
    return () => {};
  }
  
  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    
    inFlightKeys.add(cacheKey);
    
    const abortController = new AbortController();
    const fetchPromise = fetchQuoteWithRetry(request, abortController.signal);
    
    currentRequest = {
      promise: fetchPromise,
      abortController,
    };
    
    try {
      callback({ quote: null, error: null, isRetrying: true });
      
      const quote = await fetchPromise;
      cacheQuote(cacheKey, quote);
      callback({ quote, error: null, isRetrying: false });
    } catch (error: any) {
      if (error.message !== "Quote request cancelled") {
        const userMessage = getUserFriendlyErrorMessage(error);
        callback({ quote: null, error: userMessage, isRetrying: false });
      }
    } finally {
      inFlightKeys.delete(cacheKey);
      currentRequest = null;
    }
  }, DEBOUNCE_MS);
  
  return cancelPendingQuote;
}

export function clearQuoteCache(): void {
  quoteCache.clear();
}
