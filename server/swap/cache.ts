export class TTLCache<K, V> {
  private cache = new Map<K, { value: V; expiresAt: number }>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 5000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  set(key: K, value: V, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.cache.set(key, { value, expiresAt });
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  size(): number {
    this.prune();
    return this.cache.size;
  }
}

export class InFlightDeduper<K, V> {
  private inFlight = new Map<K, Promise<V>>();

  async dedupe(key: K, fetcher: () => Promise<V>): Promise<V> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const promise = fetcher().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  isInFlight(key: K): boolean {
    return this.inFlight.has(key);
  }
}

export const CACHE_TTLS = {
  routeQuote: 1500,
  tokenMetadata: 600_000,
  pumpDetection: 300_000,
  tokenList: 21600_000,
} as const;

export const quoteCache = new TTLCache<string, any>(CACHE_TTLS.routeQuote);
export const pumpDetectionCache = new TTLCache<string, any>(CACHE_TTLS.pumpDetection);
export const tokenMetadataCache = new TTLCache<string, any>(CACHE_TTLS.tokenMetadata);

export const quoteDeduper = new InFlightDeduper<string, any>();
export const pumpDetectionDeduper = new InFlightDeduper<string, any>();
