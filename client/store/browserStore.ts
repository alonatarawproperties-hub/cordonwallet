import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import React from "react";

const RECENTS_KEY = "@cordon/browser_recents";
const MAX_RECENTS = 20;

export interface RecentSite {
  url: string;
  title: string;
  favicon?: string;
  visitedAt: number;
}

interface BrowserStoreContextType {
  recents: RecentSite[];
  isLoading: boolean;
  addRecent: (site: Omit<RecentSite, "visitedAt">) => Promise<void>;
  removeRecent: (url: string) => Promise<void>;
  clearRecents: () => Promise<void>;
  refreshRecents: () => Promise<void>;
}

const BrowserStoreContext = createContext<BrowserStoreContextType | null>(null);

export function BrowserStoreProvider({ children }: { children: ReactNode }) {
  const [recents, setRecents] = useState<RecentSite[]>([]);
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
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecents();
  }, [loadRecents]);

  const saveRecents = useCallback(async (newRecents: RecentSite[]) => {
    try {
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(newRecents));
    } catch (error) {
      console.error("[BrowserStore] Failed to save recents:", error);
    }
  }, []);

  const addRecent = useCallback(
    async (site: Omit<RecentSite, "visitedAt">) => {
      const newSite: RecentSite = {
        ...site,
        visitedAt: Date.now(),
      };

      setRecents((prev) => {
        const filtered = prev.filter((r) => r.url !== site.url);
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
  }, [loadRecents]);

  return React.createElement(
    BrowserStoreContext.Provider,
    {
      value: {
        recents,
        isLoading,
        addRecent,
        removeRecent,
        clearRecents,
        refreshRecents,
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
