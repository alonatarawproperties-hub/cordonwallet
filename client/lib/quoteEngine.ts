import { AppState, AppStateStatus } from "react-native";
import { swapLogger, isRetryableError, getUserFriendlyErrorMessage } from "./swapLogger";
import { getApiUrl } from "@/lib/query-client";
import type { QuoteResponse } from "@/services/jupiter";
import { SwapSpeed, QUOTE_REFRESH_INTERVALS, QUOTE_DEBOUNCE_MS } from "@/constants/solanaSwap";

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  speedMode: SwapSpeed;
}

export interface PumpMeta {
  isPump: boolean;
  isBondingCurve: boolean;
  isGraduated: boolean;
  mint: string;
  updatedAt: number;
}

export type SwapRoute = "jupiter" | "pump" | "none";

export interface RouteQuoteResponse {
  ok: boolean;
  route: SwapRoute;
  quoteResponse?: QuoteResponse;
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

export interface QuoteEngineState {
  quote: QuoteResponse | null;
  route: SwapRoute;
  pumpMeta: PumpMeta | null;
  isUpdating: boolean;
  error: string | null;
}

export type QuoteEngineCallback = (state: QuoteEngineState) => void;

const ANTI_SPAM_MS = 1200;
const MAX_RETRIES = 2;
const RETRY_DELAYS = [300, 800];
const RATE_LIMIT_COOLDOWN_MS = 2000;
const RATE_LIMIT_BACKOFF_MS = 4000;
const RATE_LIMIT_SLOW_MODE_DURATION_MS = 60000;
const LIVE_QUOTES_INTERVAL_MS = 2000;
const DEFAULT_POLL_INTERVAL_MS = 12000;

class QuoteEngine {
  private speedMode: SwapSpeed = "standard";
  private liveQuotesEnabled = false;
  private isTyping = false;
  private lastInputAt = 0;
  private isFocused = false;
  private isAppActive = true;
  private inFlight = false;
  private requestId = 0;
  private lastParamsHash = "";
  private lastFetchAt = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private rateLimitCooldownUntil = 0;
  private rateLimitSlowModeUntil = 0;
  private abortController: AbortController | null = null;

  private currentParams: QuoteParams | null = null;
  private lastQuote: QuoteResponse | null = null;
  private lastRoute: SwapRoute = "none";
  private lastPumpMeta: PumpMeta | null = null;
  private callback: QuoteEngineCallback | null = null;

  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

  constructor() {
    this.setupAppStateListener();
  }

  private setupAppStateListener() {
    this.appStateSubscription = AppState.addEventListener("change", this.handleAppStateChange);
    this.isAppActive = AppState.currentState === "active";
  }

  private handleAppStateChange = (nextState: AppStateStatus) => {
    const wasActive = this.isAppActive;
    this.isAppActive = nextState === "active";

    if (!wasActive && this.isAppActive) {
      swapLogger.debug("QuoteEngine", "App became active, resuming");
      this.fetchQuoteOnce();
      this.startPollingIfAllowed();
    } else if (wasActive && !this.isAppActive) {
      swapLogger.debug("QuoteEngine", "App went background, pausing");
      this.stopPolling();
      this.cancelInFlight();
    }
  };

  private computeParamsHash(params: QuoteParams): string {
    return `${params.inputMint}|${params.outputMint}|${params.amount}|${params.slippageBps}|${params.speedMode}`;
  }

  private getRefreshInterval(): number {
    if (Date.now() < this.rateLimitSlowModeUntil) {
      return DEFAULT_POLL_INTERVAL_MS;
    }
    
    if (this.liveQuotesEnabled && this.speedMode === "turbo") {
      return LIVE_QUOTES_INTERVAL_MS;
    }
    
    return QUOTE_REFRESH_INTERVALS[this.speedMode];
  }

  setLiveQuotes(enabled: boolean) {
    this.liveQuotesEnabled = enabled;
    swapLogger.debug("QuoteEngine", `Live quotes ${enabled ? "enabled" : "disabled"}`);
    if (this.isFocused && this.isAppActive) {
      this.startPollingIfAllowed();
    }
  }

  getLiveQuotesEnabled(): boolean {
    return this.liveQuotesEnabled;
  }

  private isValidToFetch(): boolean {
    if (!this.currentParams) return false;
    const amount = parseFloat(this.currentParams.amount);
    if (isNaN(amount) || amount <= 0) return false;
    if (!this.currentParams.inputMint || !this.currentParams.outputMint) return false;
    if (!this.isFocused) return false;
    if (!this.isAppActive) return false;
    return true;
  }

  private emit(state: Partial<QuoteEngineState>) {
    if (this.callback) {
      this.callback({
        quote: this.lastQuote,
        route: this.lastRoute,
        pumpMeta: this.lastPumpMeta,
        isUpdating: this.inFlight,
        error: null,
        ...state,
      });
    }
  }

  private cancelInFlight() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private stopPolling() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private startPollingIfAllowed() {
    this.stopPolling();

    if (this.isTyping) return;
    if (!this.isValidToFetch()) return;

    const interval = this.getRefreshInterval();
    swapLogger.debug("QuoteEngine", `Starting polling every ${interval}ms (${this.speedMode})`);
    
    this.intervalId = setInterval(() => {
      this.fetchQuoteOnce();
    }, interval);
  }

  private async fetchQuoteOnce() {
    if (!this.isValidToFetch()) return;
    if (this.inFlight) {
      swapLogger.debug("QuoteEngine", "Skipped: already in flight");
      return;
    }

    const params = this.currentParams!;
    const paramsHash = this.computeParamsHash(params);

    if (paramsHash === this.lastParamsHash && (Date.now() - this.lastFetchAt) < ANTI_SPAM_MS) {
      swapLogger.debug("QuoteEngine", "Skipped: anti-spam");
      return;
    }

    if (Date.now() < this.rateLimitCooldownUntil) {
      swapLogger.debug("QuoteEngine", "Skipped: rate limit cooldown");
      return;
    }

    this.inFlight = true;
    this.requestId++;
    const localRequestId = this.requestId;

    this.emit({ isUpdating: true });

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const result = await this.fetchWithRetry(params, signal);

      if (localRequestId !== this.requestId) {
        swapLogger.debug("QuoteEngine", "Ignored stale response");
        return;
      }

      this.lastParamsHash = paramsHash;
      this.lastFetchAt = Date.now();
      this.lastRoute = result.route;
      this.lastPumpMeta = result.pumpMeta || null;

      if (result.route === "jupiter" && result.quoteResponse) {
        this.lastQuote = result.quoteResponse;
        this.emit({ quote: result.quoteResponse, route: "jupiter", pumpMeta: null, isUpdating: false, error: null });
        swapLogger.info("QuoteEngine", "Jupiter quote updated", { outAmount: result.quoteResponse.outAmount });
      } else if (result.route === "pump" && result.pumpMeta) {
        this.lastQuote = null;
        this.emit({ quote: null, route: "pump", pumpMeta: result.pumpMeta, isUpdating: false, error: null });
        swapLogger.info("QuoteEngine", "Pump route detected", { mint: result.pumpMeta.mint });
      } else {
        this.lastQuote = null;
        this.emit({ quote: null, route: "none", pumpMeta: null, isUpdating: false, error: result.message || "No route available" });
        swapLogger.info("QuoteEngine", "No route found", { reason: result.reason });
      }
    } catch (error: any) {
      if (error.message === "Quote request cancelled") {
        return;
      }

      if (localRequestId !== this.requestId) return;

      const userMessage = getUserFriendlyErrorMessage(error);
      
      if (this.lastQuote) {
        this.emit({ quote: this.lastQuote, route: this.lastRoute, pumpMeta: this.lastPumpMeta, isUpdating: false, error: null });
        swapLogger.transient("QuoteEngine", `Kept last quote after error: ${error.message}`);
      } else {
        this.emit({ quote: null, route: "none", pumpMeta: null, isUpdating: false, error: userMessage });
      }
    } finally {
      this.inFlight = false;
      this.abortController = null;
    }
  }

  private async fetchWithRetry(params: QuoteParams, signal: AbortSignal): Promise<RouteQuoteResponse> {
    const baseUrl = getApiUrl();
    const urlParams = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: params.slippageBps.toString(),
    });

    const url = `${baseUrl}/api/swap/solana/route-quote?${urlParams.toString()}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal.aborted) {
        throw new Error("Quote request cancelled");
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        signal.addEventListener("abort", () => controller.abort());

        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Unknown error" }));

          if (response.status === 404) {
            return {
              ok: false,
              route: "none",
              reason: "NO_ROUTE",
              message: errorData.message || "No swap routes found",
            };
          }

          if (response.status === 429) {
            this.rateLimitCooldownUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
            this.rateLimitSlowModeUntil = Date.now() + RATE_LIMIT_SLOW_MODE_DURATION_MS;
            swapLogger.transient("QuoteEngine", "Rate limited, entering slow mode for 60s");
            this.startPollingIfAllowed();
          }

          if (isRetryableError(response.status) && attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] || 500));
            continue;
          }

          throw new Error(`Quote failed (${response.status}): ${errorData.error || errorData.message || JSON.stringify(errorData)}`);
        }

        return await response.json();
      } catch (error: any) {
        if (error.name === "AbortError" || signal.aborted) {
          throw new Error("Quote request cancelled");
        }

        lastError = error;

        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] || 500));
        }
      }
    }

    throw lastError || new Error("Failed to get quote");
  }

  setCallback(cb: QuoteEngineCallback | null) {
    this.callback = cb;
  }

  setFocused(focused: boolean) {
    const wasFocused = this.isFocused;
    this.isFocused = focused;

    if (!wasFocused && focused) {
      swapLogger.debug("QuoteEngine", "Screen focused");
      this.fetchQuoteOnce();
      this.startPollingIfAllowed();
    } else if (wasFocused && !focused) {
      swapLogger.debug("QuoteEngine", "Screen blurred");
      this.stopPolling();
      this.cancelInFlight();
    }
  }

  setSpeedMode(mode: SwapSpeed) {
    if (mode !== this.speedMode) {
      this.speedMode = mode;
      swapLogger.debug("QuoteEngine", `Speed mode changed to ${mode}`);
      
      if (this.isFocused && this.isAppActive && !this.isTyping) {
        this.startPollingIfAllowed();
      }
    }
  }

  updateParams(params: QuoteParams) {
    this.currentParams = params;
    this.speedMode = params.speedMode;

    this.isTyping = true;
    this.lastInputAt = Date.now();

    this.stopPolling();

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.isTyping = false;
      this.fetchQuoteOnce();
      this.startPollingIfAllowed();
    }, QUOTE_DEBOUNCE_MS);
  }

  triggerImmediateFetch() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.isTyping = false;
    this.fetchQuoteOnce();
    this.startPollingIfAllowed();
  }

  clearQuote() {
    this.stopPolling();
    this.cancelInFlight();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.lastQuote = null;
    this.lastRoute = "none";
    this.lastPumpMeta = null;
    this.lastParamsHash = "";
    this.currentParams = null;
    this.emit({ quote: null, route: "none", pumpMeta: null, isUpdating: false, error: null });
  }

  getLastQuote(): QuoteResponse | null {
    return this.lastQuote;
  }

  getLastRoute(): SwapRoute {
    return this.lastRoute;
  }

  getLastPumpMeta(): PumpMeta | null {
    return this.lastPumpMeta;
  }

  destroy() {
    this.stopPolling();
    this.cancelInFlight();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
    }
    this.callback = null;
  }
}

let engineInstance: QuoteEngine | null = null;

export function getQuoteEngine(): QuoteEngine {
  if (!engineInstance) {
    engineInstance = new QuoteEngine();
  }
  return engineInstance;
}

export function destroyQuoteEngine() {
  if (engineInstance) {
    engineInstance.destroy();
    engineInstance = null;
  }
}
