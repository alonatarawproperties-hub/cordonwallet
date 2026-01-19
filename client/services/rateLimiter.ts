type QueuedRequest<T> = {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

class RateLimiter {
  private queue: QueuedRequest<unknown>[] = [];
  private lastRequestTime = 0;
  private isProcessing = false;
  private minIntervalMs: number;

  constructor(requestsPerSecond: number = 2) {
    this.minIntervalMs = 1000 / requestsPerSecond;
  }

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        execute: fn,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      const waitTime = Math.max(0, this.minIntervalMs - elapsed);

      if (waitTime > 0) {
        await this.sleep(waitTime);
      }

      const request = this.queue.shift();
      if (request) {
        this.lastRequestTime = Date.now();
        try {
          const result = await request.execute();
          request.resolve(result);
        } catch (error) {
          request.reject(error);
        }
      }
    }

    this.isProcessing = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  clear(): void {
    this.queue = [];
  }
}

export const rpcLimiter = new RateLimiter(3);

export const dexLimiter = new RateLimiter(2);

export const jupiterLimiter = new RateLimiter(1);

export async function withRateLimit<T>(
  limiter: RateLimiter,
  fn: () => Promise<T>
): Promise<T> {
  return limiter.enqueue(fn);
}
