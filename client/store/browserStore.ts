import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import React from "react";

const RECENTS_KEY = "@cordon/browser_recents";
const CONNECTED_DAPPS_KEY = "@cordon/browser_connected_dapps";
const MAX_RECENTS = 20;

export interface RecentSite {
  url: string;
  title: string;
  favicon?: string;
  visitedAt: number;
}

export interface ConnectedDApp {
  id: string;
  url: string;
  name: string;
  favicon?: string;
  chain: "solana" | "evm";
  walletAddress: string;
  connectedAt: number;
}

interface BrowserStoreContextType {
  recents: RecentSite[];
  connectedDApps: ConnectedDApp[];
  isLoading: boolean;
  addRecent: (site: Omit<RecentSite, "visitedAt">) => Promise<void>;
  removeRecent: (url: string) => Promise<void>;
  clearRecents: () => Promise<void>;
  refreshRecents: () => Promise<void>;
  addConnectedDApp: (dapp: Omit<ConnectedDApp, "id" | "connectedAt">) => Promise<void>;
  removeConnectedDApp: (id: string) => Promise<void>;
  clearConnectedDApps: () => Promise<void>;
}

const BrowserStoreContext = createContext<BrowserStoreContextType | null>(null);

export function BrowserStoreProvider({ children }: { children: ReactNode }) {
  const [recents, setRecents] = useState<RecentSite[]>([]);
  const [connectedDApps, setConnectedDApps] = useState<ConnectedDApp[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadRecents = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(RECENTS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as RecentSite[];
        setRecents(parsed.sort((a, b) => b.visitedAt - a.visitedAt));
      }
    } catch (error) {
      console.error("[BrowserStore] Failed to load recents:", error);
    }
  }, []);

  const loadConnectedDApps = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(CONNECTED_DAPPS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ConnectedDApp[];
        setConnectedDApps(parsed.sort((a, b) => b.connectedAt - a.connectedAt));
      }
    } catch (error) {
      console.error("[BrowserStore] Failed to load connected dApps:", error);
    }
  }, []);

  useEffect(() => {
    const loadAll = async () => {
      await Promise.all([loadRecents(), loadConnectedDApps()]);
      setIsLoading(false);
    };
    loadAll();
  }, [loadRecents, loadConnectedDApps]);

  const saveRecents = useCallback(async (newRecents: RecentSite[]) => {
    try {
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(newRecents));
    } catch (error) {
      console.error("[BrowserStore] Failed to save recents:", error);
    }
  }, []);

  const saveConnectedDApps = useCallback(async (dapps: ConnectedDApp[]) => {
    try {
      await AsyncStorage.setItem(CONNECTED_DAPPS_KEY, JSON.stringify(dapps));
    } catch (error) {
      console.error("[BrowserStore] Failed to save connected dApps:", error);
    }
  }, []);

  const addRecent = useCallback(
    async (site: Omit<RecentSite, "visitedAt">) => {
      const newSite: RecentSite = {
        ...site,
        visitedAt: Date.now(),
      };

      // Extract domain for deduplication
      const getDomain = (url: string): string => {
        try {
          return new URL(url).hostname;
        } catch {
          return url;
        }
      };
      
      const newDomain = getDomain(site.url);

      setRecents((prev) => {
        // Filter out any entries from the same domain (not just exact URL)
        const filtered = prev.filter((r) => getDomain(r.url) !== newDomain);
        const updated = [newSite, ...filtered].slice(0, MAX_RECENTS);
        saveRecents(updated);
        return updated;
      });
    },
    [saveRecents]
  );

  const removeRecent = useCallback(
    async (url: string) => {
      setRecents((prev) => {
        const updated = prev.filter((r) => r.url !== url);
        saveRecents(updated);
        return updated;
      });
    },
    [saveRecents]
  );

  const clearRecents = useCallback(async () => {
    setRecents([]);
    await AsyncStorage.removeItem(RECENTS_KEY);
  }, []);

  const refreshRecents = useCallback(async () => {
    setIsLoading(true);
    await loadRecents();
    setIsLoading(false);
  }, [loadRecents]);

  const addConnectedDApp = useCallback(
    async (dapp: Omit<ConnectedDApp, "id" | "connectedAt">) => {
      const newDApp: ConnectedDApp = {
        ...dapp,
        id: `${dapp.chain}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        connectedAt: Date.now(),
      };

      setConnectedDApps((prev) => {
        const filtered = prev.filter(
          (d) => !(d.url === dapp.url && d.chain === dapp.chain && d.walletAddress === dapp.walletAddress)
        );
        const updated = [newDApp, ...filtered];
        saveConnectedDApps(updated);
        return updated;
      });
    },
    [saveConnectedDApps]
  );

  const removeConnectedDApp = useCallback(
    async (id: string) => {
      setConnectedDApps((prev) => {
        const updated = prev.filter((d) => d.id !== id);
        saveConnectedDApps(updated);
        return updated;
      });
    },
    [saveConnectedDApps]
  );

  const clearConnectedDApps = useCallback(async () => {
    setConnectedDApps([]);
    await AsyncStorage.removeItem(CONNECTED_DAPPS_KEY);
  }, []);

  return React.createElement(
    BrowserStoreContext.Provider,
    {
      value: {
        recents,
        connectedDApps,
        isLoading,
        addRecent,
        removeRecent,
        clearRecents,
        refreshRecents,
        addConnectedDApp,
        removeConnectedDApp,
        clearConnectedDApps,
      },
    },
    children
  );
}

export function useBrowserStore() {
  const context = useContext(BrowserStoreContext);
  if (!context) {
    throw new Error("useBrowserStore must be used within BrowserStoreProvider");
  }
  return context;
}

export function getFaviconUrl(url: string, bustCache = false): string {
  try {
    const parsedUrl = new URL(url);
    const domain = parsedUrl.hostname;
    const cacheBuster = bustCache ? `&_t=${Date.now()}` : "";
    return `https://icons.duckduckgo.com/ip3/${domain}.ico${cacheBuster ? `?${cacheBuster}` : ""}`;
  } catch {
    return "";
  }
}

export function getDirectFaviconUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.origin}/favicon.ico`;
  } catch {
    return "";
  }
}

export function normalizeUrl(input: string): string {
  let url = input.trim();
  
  if (url.startsWith("javascript:") || url.startsWith("file:") || url.startsWith("data:")) {
    throw new Error("Blocked URL scheme");
  }
  
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    if (url.includes(".") && !url.includes(" ")) {
      url = `https://${url}`;
    } else {
      url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }
  }
  
  return url;
}
