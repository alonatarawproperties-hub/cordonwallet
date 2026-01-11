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

import { 
  checkApprovalPolicy,
  saveApproval,
  getSpenderLabel,
  DetectedApproval,
  MAX_UINT256,
} from "../approvals";
import type { PolicySettings } from "../types";

const ERC20_ABI = [
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
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
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
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
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

export interface SendApprovalParams {
  chainId: number;
  walletId: string;
  tokenAddress: `0x${string}`;
  tokenDecimals: number;
  tokenSymbol?: string;
  tokenName?: string;
  spender: `0x${string}`;
  amount: string;
  policySettings: PolicySettings;
}

export interface ApprovalBlockedError {
  code: "APPROVAL_BLOCKED";
  message: string;
  suggestion: string;
  suggestedAmount?: string;
}

export class ApprovalPolicyError extends Error {
  code: string;
  suggestion: string;
  suggestedAmount?: string;
  
  constructor(error: ApprovalBlockedError) {
    super(error.message);
    this.name = "ApprovalPolicyError";
    this.code = error.code;
    this.suggestion = error.suggestion;
    this.suggestedAmount = error.suggestedAmount;
  }
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
    abi: ERC20_ABI,
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
      abi: ERC20_ABI,
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
      abi: ERC20_ABI,
      functionName: "decimals",
    });
    return Number(decimals);
  } catch {
    return 18;
  }
}

export async function estimateApprovalGas(
  chainId: number,
  from: `0x${string}`,
  tokenAddress: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint
): Promise<GasEstimate> {
  const chainConfig = getChainById(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const publicClient = getPublicClient(chainId);

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, amount],
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

export async function sendApproval(params: SendApprovalParams): Promise<TransactionResult> {
  const { 
    chainId, 
    walletId, 
    tokenAddress, 
    tokenDecimals, 
    tokenSymbol,
    tokenName,
    spender, 
    amount, 
    policySettings 
  } = params;

  const chainConfig = getChainById(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  if (!spender.startsWith("0x") || spender.length !== 42) {
    throw new Error("Invalid spender address");
  }

  if (!tokenAddress.startsWith("0x") || tokenAddress.length !== 42) {
    throw new Error("Invalid token address");
  }

  const parsedAmount = parseUnits(amount, tokenDecimals);
  
  const isUnlimited = parsedAmount >= MAX_UINT256 / 2n;
  
  const detectedApproval: DetectedApproval = {
    tokenAddress,
    spender,
    amountRaw: parsedAmount,
    isUnlimited,
  };

  const policyResult = checkApprovalPolicy({
    chainId,
    approval: detectedApproval,
    policySettings,
    tokenDecimals,
    tokenSymbol: tokenSymbol || "tokens",
  });
  
  if (!policyResult.allowed) {
    throw new ApprovalPolicyError({
      code: "APPROVAL_BLOCKED",
      message: policyResult.reason || "Approval blocked by policy",
      suggestion: policyResult.suggestedCapFormatted 
        ? `Use a capped amount of ${policyResult.suggestedCapFormatted}` 
        : "Try a smaller amount",
      suggestedAmount: policyResult.suggestedCap?.toString(),
    });
  }

  try {
    const privateKey = await derivePrivateKey(walletId);
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClientForChain(chainConfig, account);

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, parsedAmount],
    });

    const gasEstimate = await estimateApprovalGas(
      chainId,
      account.address,
      tokenAddress,
      spender,
      parsedAmount
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

    await saveApproval({
      chainId,
      owner: account.address,
      tokenAddress,
      tokenSymbol: tokenSymbol || undefined,
      tokenName: tokenName || undefined,
      tokenDecimals,
      spender,
      spenderLabel: getSpenderLabel(chainId, spender) || undefined,
      allowanceRaw: parsedAmount.toString(),
      txHash: hash,
    });

    return {
      hash,
      chainId,
      explorerUrl: getExplorerTxUrl(chainId, hash),
    };
  } catch (error) {
    if (error instanceof ApprovalPolicyError) {
      throw error;
    }
    const txError = formatTransactionError(error);
    throw new TransactionFailedError(txError);
  }
}

export interface SignMessageParams {
  walletId: string;
  message: string;
}

export async function signPersonalMessage(params: SignMessageParams): Promise<`0x${string}`> {
  const { walletId, message } = params;
  
  try {
    const privateKey = await derivePrivateKey(walletId);
    const account = privateKeyToAccount(privateKey);
    
    const signature = await account.signMessage({
      message: message.startsWith("0x") 
        ? { raw: message as `0x${string}` }
        : message,
    });
    
    return signature;
  } catch (error) {
    if (error instanceof WalletLockedError) {
      throw error;
    }
    const txError = formatTransactionError(error);
    throw new TransactionFailedError(txError);
  }
}

export interface SendRawTransactionParams {
  chainId: number;
  walletId: string;
  to: `0x${string}`;
  value?: bigint;
  data?: `0x${string}`;
  gas?: bigint;
}

export async function sendRawTransaction(params: SendRawTransactionParams): Promise<TransactionResult> {
  const { chainId, walletId, to, value = 0n, data, gas } = params;

  const chainConfig = getChainById(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  try {
    console.log("[sendRawTransaction] Starting:", { chainId, to, value: value.toString(), hasData: !!data });
    
    const privateKey = await derivePrivateKey(walletId);
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClientForChain(chainConfig, account);
    const publicClient = getPublicClient(chainId);

    console.log("[sendRawTransaction] Estimating gas for:", account.address);
    
    let estimatedGas: bigint;
    try {
      estimatedGas = gas || await publicClient.estimateGas({
        account: account.address,
        to,
        value,
        data,
      });
    } catch (gasError) {
      console.error("[sendRawTransaction] Gas estimation failed:", gasError);
      const errorMessage = gasError instanceof Error ? gasError.message : String(gasError);
      if (errorMessage.includes("insufficient funds")) {
        throw new Error("Insufficient funds for gas. Please add funds to your wallet.");
      }
      if (errorMessage.includes("execution reverted")) {
        throw new Error("Transaction would fail. The contract rejected this action.");
      }
      throw gasError;
    }

    console.log("[sendRawTransaction] Gas estimated:", estimatedGas.toString());

    const feeData = await publicClient.estimateFeesPerGas();
    const isLegacyChain = !feeData.maxPriorityFeePerGas;

    const txParams = isLegacyChain
      ? {
          account,
          chain: chainConfig.viemChain,
          to,
          value,
          data,
          gas: estimatedGas,
          gasPrice: feeData.gasPrice,
        }
      : {
          account,
          chain: chainConfig.viemChain,
          to,
          value,
          data,
          gas: estimatedGas,
          maxFeePerGas: feeData.maxFeePerGas,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        };

    console.log("[sendRawTransaction] Sending transaction...");
    const hash = await walletClient.sendTransaction(txParams as any);
    console.log("[sendRawTransaction] Transaction sent:", hash);

    return {
      hash,
      chainId,
      explorerUrl: getExplorerTxUrl(chainId, hash),
    };
  } catch (error) {
    console.error("[sendRawTransaction] Error:", error);
    if (error instanceof WalletLockedError) {
      throw error;
    }
    if (error instanceof Error) {
      if (error.message.includes("insufficient funds") || error.message.includes("Insufficient funds")) {
        throw new TransactionFailedError({ message: "Insufficient funds for this transaction", code: "INSUFFICIENT_FUNDS" });
      }
      if (error.message.includes("execution reverted")) {
        throw new TransactionFailedError({ message: "Transaction would fail on-chain", code: "EXECUTION_REVERTED" });
      }
      if (error.message.includes("nonce")) {
        throw new TransactionFailedError({ message: "Transaction nonce conflict. Please try again.", code: "NONCE_ERROR" });
      }
    }
    const txError = formatTransactionError(error);
    throw new TransactionFailedError(txError);
  }
}

export interface SignSolanaMessageParams {
  walletId: string;
  message: string;
}

export async function signSolanaMessage(params: SignSolanaMessageParams): Promise<string> {
  const { walletId, message } = params;
  
  console.log("[signSolanaMessage] Starting with params:", { walletId, messageLength: message?.length });
  
  try {
    const { deriveSolanaKeypair } = await import("../solana/keys");
    const nacl = await import("tweetnacl");
    
    console.log("[signSolanaMessage] Modules loaded, getting mnemonic...");
    
    const mnemonic = await getMnemonic(walletId);
    if (!mnemonic) {
      console.log("[signSolanaMessage] No mnemonic found");
      throw new WalletLockedError();
    }
    
    console.log("[signSolanaMessage] Got mnemonic, deriving keypair...");
    const { secretKey, publicKey } = deriveSolanaKeypair(mnemonic);
    console.log("[signSolanaMessage] Keypair derived, pubkey:", publicKey);
    
    let messageBytes: Uint8Array;
    try {
      messageBytes = Uint8Array.from(Buffer.from(message, "base64"));
      console.log("[signSolanaMessage] Decoded base64 message, length:", messageBytes.length);
    } catch {
      messageBytes = new TextEncoder().encode(message);
      console.log("[signSolanaMessage] Using UTF-8 encoded message, length:", messageBytes.length);
    }
    
    console.log("[signSolanaMessage] Signing message...");
    const signature = nacl.sign.detached(messageBytes, secretKey);
    const signatureBase64 = Buffer.from(signature).toString("base64");
    console.log("[signSolanaMessage] Success! Signature length:", signatureBase64.length);
    return signatureBase64;
  } catch (error) {
    console.error("[signSolanaMessage] Error:", error);
    if (error instanceof WalletLockedError) {
      throw error;
    }
    const txError = formatTransactionError(error);
    throw new TransactionFailedError(txError);
  }
}

export interface SignSolanaTransactionParams {
  walletId: string;
  transaction: string;
}

export async function signSolanaTransaction(params: SignSolanaTransactionParams): Promise<string> {
  const { walletId, transaction } = params;
  
  console.log("[signSolanaTransaction] Starting with params:", { walletId, txLength: transaction?.length });
  
  try {
    const { deriveSolanaKeypair } = await import("../solana/keys");
    const { Transaction, VersionedTransaction, Keypair } = await import("@solana/web3.js");
    
    console.log("[signSolanaTransaction] Modules loaded, getting mnemonic...");
    
    const mnemonic = await getMnemonic(walletId);
    if (!mnemonic) {
      console.log("[signSolanaTransaction] No mnemonic found");
      throw new WalletLockedError();
    }
    
    console.log("[signSolanaTransaction] Got mnemonic, deriving keypair...");
    const { secretKey, publicKey } = deriveSolanaKeypair(mnemonic);
    const keypair = Keypair.fromSecretKey(secretKey);
    console.log("[signSolanaTransaction] Keypair derived, pubkey:", publicKey);
    
    const txBytes = Buffer.from(transaction, "base64");
    console.log("[signSolanaTransaction] Decoded transaction bytes, length:", txBytes.length);
    
    let signedTxBase64: string;
    
    try {
      console.log("[signSolanaTransaction] Trying versioned transaction...");
      const versionedTx = VersionedTransaction.deserialize(txBytes);
      versionedTx.sign([keypair]);
      signedTxBase64 = Buffer.from(versionedTx.serialize()).toString("base64");
      console.log("[signSolanaTransaction] Signed versioned transaction");
    } catch (versionedErr) {
      console.log("[signSolanaTransaction] Versioned failed, trying legacy:", versionedErr);
      const legacyTx = Transaction.from(txBytes);
      legacyTx.sign(keypair);
      signedTxBase64 = legacyTx.serialize().toString("base64");
      console.log("[signSolanaTransaction] Signed legacy transaction");
    }
    
    console.log("[signSolanaTransaction] Success! Signed tx length:", signedTxBase64.length);
    return signedTxBase64;
  } catch (error) {
    console.error("[signSolanaTransaction] Error:", error);
    if (error instanceof WalletLockedError) {
      throw error;
    }
    const txError = formatTransactionError(error);
    throw new TransactionFailedError(txError);
  }
}

export async function signAllSolanaTransactions(
  walletId: string, 
  transactions: string[]
): Promise<string[]> {
  const results: string[] = [];
  for (const tx of transactions) {
    const signed = await signSolanaTransaction({ walletId, transaction: tx });
    results.push(signed);
  }
  return results;
}
