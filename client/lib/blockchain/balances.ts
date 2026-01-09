import { formatUnits, Address, erc20Abi } from "viem";
import { getPublicClient, formatRpcError, RpcError } from "./client";
import { getChainById } from "./chains";

export interface BalanceResult {
  formatted: string;
  raw: bigint;
  decimals: number;
  symbol: string;
}

export interface BalanceError {
  error: RpcError;
}

export type BalanceResponse = BalanceResult | BalanceError;

function isBalanceError(result: BalanceResponse): result is BalanceError {
  return "error" in result;
}

export { isBalanceError };

export async function getNativeBalance(
  address: string,
  chainId: number
): Promise<BalanceResponse> {
  try {
    const client = getPublicClient(chainId);
    const chain = getChainById(chainId);

    if (!chain) {
      return {
        error: {
          code: "UNSUPPORTED_CHAIN",
          message: `Chain ${chainId} is not supported`,
          chainId,
        },
      };
    }

    const balance = await client.getBalance({
      address: address as Address,
    });

    return {
      formatted: formatUnits(balance, chain.nativeDecimals),
      raw: balance,
      decimals: chain.nativeDecimals,
      symbol: chain.nativeSymbol,
    };
  } catch (error) {
    return { error: formatRpcError(error, chainId) };
  }
}

export async function getERC20Balance(params: {
  tokenAddress: string;
  owner: string;
  chainId: number;
  decimals: number;
  symbol: string;
}): Promise<BalanceResponse> {
  const { tokenAddress, owner, chainId, decimals, symbol } = params;

  try {
    const client = getPublicClient(chainId);

    const balance = await client.readContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner as Address],
    });

    return {
      formatted: formatUnits(balance, decimals),
      raw: balance,
      decimals,
      symbol,
    };
  } catch (error) {
    return { error: formatRpcError(error, chainId) };
  }
}

export async function getERC20Decimals(
  tokenAddress: string,
  chainId: number
): Promise<number | null> {
  try {
    const client = getPublicClient(chainId);

    const decimals = await client.readContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: "decimals",
    });

    return decimals;
  } catch {
    return null;
  }
}

export async function getERC20Symbol(
  tokenAddress: string,
  chainId: number
): Promise<string | null> {
  try {
    const client = getPublicClient(chainId);

    const symbol = await client.readContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: "symbol",
    });

    return symbol;
  } catch {
    return null;
  }
}
