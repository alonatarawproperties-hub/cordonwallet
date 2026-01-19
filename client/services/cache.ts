const cache = new Map<string, { value: unknown; expiresAt: number }>();

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

export function deleteCached(key: string): void {
  cache.delete(key);
}

export function clearCache(): void {
  cache.clear();
}

export function getCacheKey(prefix: string, ...parts: string[]): string {
  return `${prefix}:${parts.join(":")}`;
}
