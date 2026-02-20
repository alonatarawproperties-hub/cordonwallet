import { QueryClient, QueryFunction } from "@tanstack/react-query";
import Constants from "expo-constants";

const PRODUCTION_FALLBACK_DOMAIN = "app.cordonwallet.com";

/**
 * Returns common headers that should be included in every API request.
 * Includes the API key for server authentication.
 */
export function getApiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  const apiKey = process.env.EXPO_PUBLIC_CORDON_API_KEY
    || (Constants.expoConfig as any)?.extra?.cordonApiKey;
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

/**
 * Gets the base URL for the Express API server.
 * Priority: process.env.EXPO_PUBLIC_DOMAIN > Constants.expoConfig.extra.apiDomain > fallback
 * @returns {string} The API base URL
 */
export function getApiUrl(): string {
  const envHost = process.env.EXPO_PUBLIC_DOMAIN;
  
  const extraHost =
    (Constants.expoConfig as any)?.extra?.apiDomain ||
    (Constants.manifest2 as any)?.extra?.apiDomain ||
    (Constants.manifest as any)?.extra?.apiDomain;

  const host = envHost || extraHost;

  if (__DEV__) {
    console.log("[Config] apiDomain:", host || "(using fallback)");
  }

  if (!host) {
    if (__DEV__) {
      throw new Error("EXPO_PUBLIC_DOMAIN is not set");
    }
    return `https://${PRODUCTION_FALLBACK_DOMAIN}`;
  }

  const normalized = host.startsWith("http") ? host : `https://${host}`;

  return normalized;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const res = await fetch(url, {
    method,
    headers: getApiHeaders(data ? { "Content-Type": "application/json" } : undefined),
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const res = await fetch(url, {
      headers: getApiHeaders(),
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
