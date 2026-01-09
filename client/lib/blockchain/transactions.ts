import {
  createWalletClient,
  http,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
  encodeFunctionData,
  toHex,
  WalletClient,
  Account,
  Chain,
  PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeed } from "@scure/bip39";

import { getChainById, getExplorerTxUrl, ChainConfig } from "./chains";
import { getPublicClient, formatRpcError } from "./client";
import { getMnemonic, requireUnlocked, isUnlocked, WalletLockedError } from "../wallet-engine";

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export interface SendNativeParams {
  chainId: number;
  walletId: string;
  to: `0x${string}`;
  amountNative: string;
}

export interface SendERC20Params {
  chainId: number;
  walletId: string;
  tokenAddress: `0x${string}`;
  tokenDecimals: number;
  to: `0x${string}`;
  amount: string;
}

export interface TransactionResult {
  hash: `0x${string}`;
  chainId: number;
  explorerUrl: string;
}

export interface GasEstimate {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  estimatedFeeNative: string;
  estimatedFeeFormatted: string;
  nativeSymbol: string;
}

export interface TransactionError {
  code: string;
  message: string;
  details?: string;
}

export class TransactionFailedError extends Error {
  code: string;
  details?: string;
  
  constructor(error: TransactionError) {
    super(error.message);
    this.name = "TransactionFailedError";
    this.code = error.code;
    this.details = error.details;
  }
}

async function derivePrivateKey(walletId: string): Promise<`0x${string}`> {
  if (__DEV__) {
    console.log("[Transactions] derivePrivateKey called", {
      walletId,
      isWalletUnlocked: isUnlocked(),
    });
  }
  
  requireUnlocked();
  
  const mnemonic = await getMnemonic(walletId);
  if (!mnemonic) {
    if (__DEV__) {
      console.log("[Transactions] No mnemonic found for wallet", walletId);
    }
    throw new WalletLockedError();
  }

  if (__DEV__) {
    console.log("[Transactions] Mnemonic found, deriving private key");
  }

  const seed = await mnemonicToSeed(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derivedKey = hdKey.derive("m/44'/60'/0'/0/0");

  if (!derivedKey.privateKey) {
    throw new Error("Failed to derive private key");
  }

  return toHex(derivedKey.privateKey);
}

function createWalletClientForChain(
  chainConfig: ChainConfig,
  account: Account
): WalletClient {
  return createWalletClient({
    account,
    chain: chainConfig.viemChain,
    transport: http(chainConfig.rpcUrl, {
      timeout: 30000,
      retryCount: 2,
    }),
  });
}

function formatTransactionError(error: unknown): TransactionError {
  if (error instanceof WalletLockedError) {
    return {
      code: "WALLET_LOCKED",
      message: "Please unlock your wallet first",
    };
  }
  
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    
    if (msg.includes("insufficient funds") || msg.includes("insufficient balance")) {
      return {
        code: "INSUFFICIENT_FUNDS",
        message: "Not enough balance to cover the transaction and gas fees",
      };
    }
    if (msg.includes("nonce")) {
      return {
        code: "NONCE_ERROR",
        message: "Transaction ordering issue. Please try again.",
      };
    }
    if (msg.includes("gas")) {
      return {
        code: "GAS_ERROR",
        message: "Failed to estimate gas. The transaction may fail.",
      };
    }
    if (msg.includes("rejected") || msg.includes("denied")) {
      return {
        code: "USER_REJECTED",
        message: "Transaction was cancelled",
      };
    }
    if (msg.includes("timeout")) {
      return {
        code: "TIMEOUT",
        message: "Network request timed out. Please try again.",
      };
    }
    if (msg.includes("locked") || msg.includes("mnemonic not found")) {
      return {
        code: "WALLET_LOCKED",
        message: "Please unlock your wallet first",
      };
    }

    return {
      code: "TRANSACTION_FAILED",
      message: "Transaction failed. Please try again.",
      details: error.message,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "An unexpected error occurred",
  };
}

async function getFeeData(
  publicClient: PublicClient,
  chainId: number
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  try {
    const feeData = await publicClient.estimateFeesPerGas();
    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      return {
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      };
    }
  } catch {
    // EIP-1559 not supported, fall back to legacy gas price
  }

  const gasPrice = await publicClient.getGasPrice();
  return {
    maxFeePerGas: gasPrice,
    maxPriorityFeePerGas: BigInt(0),
  };
}

export async function estimateNativeGas(
  chainId: number,
  from: `0x${string}`,
  to: `0x${string}`,
  amountNative: string
): Promise<GasEstimate> {
  const chainConfig = getChainById(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const publicClient = getPublicClient(chainId);
  const value = parseEther(amountNative);

  const [gasLimit, feeData] = await Promise.all([
    publicClient.estimateGas({
      account: from,
      to,
      value,
    }),
    getFeeData(publicClient, chainId),
  ]);

  const { maxFeePerGas, maxPriorityFeePerGas } = feeData;
  const estimatedFee = gasLimit * maxFeePerGas;
  const estimatedFeeNative = formatEther(estimatedFee);

  return {
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    estimatedFeeNative,
    estimatedFeeFormatted: `${parseFloat(estimatedFeeNative).toFixed(6)} ${chainConfig.nativeSymbol}`,
    nativeSymbol: chainConfig.nativeSymbol,
  };
}

export async function estimateERC20Gas(
  chainId: number,
  from: `0x${string}`,
  tokenAddress: `0x${string}`,
  to: `0x${string}`,
  amount: string,
  tokenDecimals: number
): Promise<GasEstimate> {
  const chainConfig = getChainById(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const publicClient = getPublicClient(chainId);
  const parsedAmount = parseUnits(amount, tokenDecimals);

  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [to, parsedAmount],
  });

  const [gasLimit, feeData] = await Promise.all([
    publicClient.estimateGas({
      account: from,
      to: tokenAddress,
      data,
    }),
    getFeeData(publicClient, chainId),
  ]);

  const { maxFeePerGas, maxPriorityFeePerGas } = feeData;
  const estimatedFee = gasLimit * maxFeePerGas;
  const estimatedFeeNative = formatEther(estimatedFee);

  return {
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    estimatedFeeNative,
    estimatedFeeFormatted: `${parseFloat(estimatedFeeNative).toFixed(6)} ${chainConfig.nativeSymbol}`,
    nativeSymbol: chainConfig.nativeSymbol,
  };
}

export async function sendNative(params: SendNativeParams): Promise<TransactionResult> {
  const { chainId, walletId, to, amountNative } = params;

  const chainConfig = getChainById(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  if (!to.startsWith("0x") || to.length !== 42) {
    throw new Error("Invalid recipient address");
  }

  try {
    const privateKey = await derivePrivateKey(walletId);
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClientForChain(chainConfig, account);

    const value = parseEther(amountNative);
    const gasEstimate = await estimateNativeGas(chainId, account.address, to, amountNative);

    const isLegacyChain = gasEstimate.maxPriorityFeePerGas === BigInt(0);

    const txParams = isLegacyChain
      ? {
          account,
          chain: chainConfig.viemChain,
          to,
          value,
          gas: gasEstimate.gasLimit,
          gasPrice: gasEstimate.maxFeePerGas,
        }
      : {
          account,
          chain: chainConfig.viemChain,
          to,
          value,
          gas: gasEstimate.gasLimit,
          maxFeePerGas: gasEstimate.maxFeePerGas,
          maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
        };

    const hash = await walletClient.sendTransaction(txParams as any);

    return {
      hash,
      chainId,
      explorerUrl: getExplorerTxUrl(chainId, hash),
    };
  } catch (error) {
    const txError = formatTransactionError(error);
    throw new TransactionFailedError(txError);
  }
}

export async function sendERC20(params: SendERC20Params): Promise<TransactionResult> {
  const { chainId, walletId, tokenAddress, tokenDecimals, to, amount } = params;

  const chainConfig = getChainById(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  if (!to.startsWith("0x") || to.length !== 42) {
    throw new Error("Invalid recipient address");
  }

  if (!tokenAddress.startsWith("0x") || tokenAddress.length !== 42) {
    throw new Error("Invalid token address");
  }

  try {
    const privateKey = await derivePrivateKey(walletId);
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClientForChain(chainConfig, account);

    const parsedAmount = parseUnits(amount, tokenDecimals);

    const data = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [to, parsedAmount],
    });

    const gasEstimate = await estimateERC20Gas(
      chainId,
      account.address,
      tokenAddress,
      to,
      amount,
      tokenDecimals
    );

    const isLegacyChain = gasEstimate.maxPriorityFeePerGas === BigInt(0);

    const txParams = isLegacyChain
      ? {
          account,
          chain: chainConfig.viemChain,
          to: tokenAddress,
          data,
          gas: gasEstimate.gasLimit,
          gasPrice: gasEstimate.maxFeePerGas,
        }
      : {
          account,
          chain: chainConfig.viemChain,
          to: tokenAddress,
          data,
          gas: gasEstimate.gasLimit,
          maxFeePerGas: gasEstimate.maxFeePerGas,
          maxPriorityFeePerGas: gasEstimate.maxPriorityFeePerGas,
        };

    const hash = await walletClient.sendTransaction(txParams as any);

    return {
      hash,
      chainId,
      explorerUrl: getExplorerTxUrl(chainId, hash),
    };
  } catch (error) {
    const txError = formatTransactionError(error);
    throw new TransactionFailedError(txError);
  }
}

export async function getTokenDecimals(
  chainId: number,
  tokenAddress: `0x${string}`
): Promise<number> {
  const publicClient = getPublicClient(chainId);

  try {
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_TRANSFER_ABI,
      functionName: "decimals",
    });
    return Number(decimals);
  } catch {
    return 18;
  }
}
