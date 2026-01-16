import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const inFlightRequests = new Map<string, Promise<any>>();
const responseCache = new Map<string, CacheEntry<any>>();

const CLEANUP_INTERVAL = 60000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) rateLimitStore.delete(key);
  }
  for (const [key, entry] of responseCache.entries()) {
    if (entry.expiresAt < now) responseCache.delete(key);
  }
}, CLEANUP_INTERVAL);

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix: string;
}

function getClientKey(req: Request, prefix: string): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const pubkey = (req.query.userPublicKey as string) || (req.body?.userPublicKey as string) || "";
  return `${prefix}:${ip}:${pubkey.slice(0, 20)}`;
}

export function createRateLimiter(config: RateLimitConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = getClientKey(req, config.keyPrefix);
    const now = Date.now();
    
    let entry = rateLimitStore.get(key);
    
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + config.windowMs };
      rateLimitStore.set(key, entry);
    }
    
    entry.count++;
    
    if (entry.count > config.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", retryAfter.toString());
      return res.status(429).json({
        error: "Rate limit exceeded",
        code: "RATE_LIMITED",
        retryAfter,
      });
    }
    
    next();
  };
}

export const quoteRateLimiter = createRateLimiter({
  maxRequests: 20,
  windowMs: 10000,
  keyPrefix: "quote",
});

export const tokenListRateLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 60000,
  keyPrefix: "tokens",
});

export const swapBuildRateLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 10000,
  keyPrefix: "swap",
});

export function dedupeMiddleware<T>(
  cacheKeyFn: (req: Request) => string,
  handler: (req: Request) => Promise<T>,
  cacheTtlMs: number = 0
) {
  return async (req: Request, res: Response) => {
    const cacheKey = cacheKeyFn(req);
    
    if (cacheTtlMs > 0) {
      const cached = responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(cached.data);
      }
    }
    
    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
      try {
        const result = await inFlight;
        return res.json(result);
      } catch (error: any) {
        return res.status(500).json({ error: error.message });
      }
    }
    
    const promise = handler(req);
    inFlightRequests.set(cacheKey, promise);
    
    try {
      const result = await promise;
      
      if (cacheTtlMs > 0) {
        responseCache.set(cacheKey, {
          data: result,
          expiresAt: Date.now() + cacheTtlMs,
        });
      }
      
      res.json(result);
    } catch (error: any) {
      res.status(error.status || 500).json({
        error: error.message,
        code: error.code || "INTERNAL_ERROR",
      });
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  };
}

export function makeQuoteCacheKey(req: Request): string {
  const { inputMint, outputMint, amount, slippageBps } = req.query;
  return `quote:${inputMint}:${outputMint}:${amount}:${slippageBps}`;
}

export function makeTokenListCacheKey(req: Request): string {
  const { tags, limit } = req.query;
  return `tokens:${tags || "all"}:${limit || "default"}`;
}
