const REFRESH_THROTTLE_MS = 10000;
const POST_SWAP_DEBOUNCE_MS = 2000;

let lastRefreshTime = 0;
let pendingRefresh: NodeJS.Timeout | null = null;
let swapJustCompleted = false;

export function shouldRefreshBalances(): boolean {
  const now = Date.now();
  return now - lastRefreshTime >= REFRESH_THROTTLE_MS;
}

export function markBalancesRefreshed(): void {
  lastRefreshTime = Date.now();
}

export function schedulePostSwapRefresh(refreshFn: () => void): void {
  if (swapJustCompleted) return;
  
  swapJustCompleted = true;
  
  if (pendingRefresh) {
    clearTimeout(pendingRefresh);
  }
  
  pendingRefresh = setTimeout(() => {
    refreshFn();
    markBalancesRefreshed();
    pendingRefresh = null;
    
    setTimeout(() => {
      swapJustCompleted = false;
    }, REFRESH_THROTTLE_MS);
  }, POST_SWAP_DEBOUNCE_MS);
}

export function throttledRefresh(refreshFn: () => void): boolean {
  if (!shouldRefreshBalances()) {
    return false;
  }
  
  refreshFn();
  markBalancesRefreshed();
  return true;
}

export function cancelPendingRefresh(): void {
  if (pendingRefresh) {
    clearTimeout(pendingRefresh);
    pendingRefresh = null;
  }
}
