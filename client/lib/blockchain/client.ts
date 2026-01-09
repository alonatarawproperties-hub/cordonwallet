import { createPublicClient, http, PublicClient, HttpTransport, Chain } from "viem";
import { getChainById, ChainConfig } from "./chains";

const clientCache = new Map<number, PublicClient<HttpTransport, Chain>>();

export interface RpcError {
  code: string;
  message: string;
  chainId: number;
}

export function getPublicClient(chainId: number): PublicClient<HttpTransport, Chain> {
  const cached = clientCache.get(chainId);
  if (cached) return cached;

  const chainConfig = getChainById(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const client = createPublicClient({
    chain: chainConfig.viemChain,
    transport: http(chainConfig.rpcUrl, {
      timeout: 10000,
      retryCount: 2,
      retryDelay: 1000,
    }),
  });

  clientCache.set(chainId, client as PublicClient<HttpTransport, Chain>);
  return client as PublicClient<HttpTransport, Chain>;
}

export function clearClientCache(): void {
  clientCache.clear();
}

export function formatRpcError(error: unknown, chainId: number): RpcError {
  if (error instanceof Error) {
    if (error.message.includes("timeout") || error.message.includes("ETIMEDOUT")) {
      return {
        code: "TIMEOUT",
        message: "Network request timed out. Please try again.",
        chainId,
      };
    }
    if (error.message.includes("rate limit") || error.message.includes("429")) {
      return {
        code: "RATE_LIMIT",
        message: "Too many requests. Please wait a moment.",
        chainId,
      };
    }
    if (error.message.includes("network") || error.message.includes("fetch")) {
      return {
        code: "NETWORK",
        message: "Network error. Check your connection.",
        chainId,
      };
    }
    return {
      code: "RPC_ERROR",
      message: error.message,
      chainId,
    };
  }
  return {
    code: "UNKNOWN",
    message: "An unexpected error occurred",
    chainId,
  };
}
