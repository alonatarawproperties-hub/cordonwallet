import { 
  createWalletClient, 
  http, 
  encodeFunctionData,
  parseAbi,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeed } from "@scure/bip39";
import { toHex } from "viem";

import { getChainById, getExplorerTxUrl } from "../blockchain/chains";
import { getPublicClient } from "../blockchain/client";
import { getMnemonic, requireUnlocked, WalletLockedError } from "../wallet-engine";
import { updateApprovalById } from "./store";

const ERC20_APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export interface RevokeApprovalParams {
  chainId: number;
  walletId: string;
  owner: `0x${string}`;
  tokenAddress: `0x${string}`;
  spender: `0x${string}`;
  approvalId: string;
}

export interface RevokeResult {
  hash: `0x${string}`;
  explorerUrl: string;
}

async function derivePrivateKey(walletId: string): Promise<`0x${string}`> {
  requireUnlocked();
  
  const mnemonic = await getMnemonic(walletId);
  if (!mnemonic) {
    throw new WalletLockedError();
  }

  const seed = await mnemonicToSeed(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const derivedKey = hdKey.derive("m/44'/60'/0'/0/0");

  if (!derivedKey.privateKey) {
    throw new Error("Failed to derive private key");
  }

  return toHex(derivedKey.privateKey);
}

export async function revokeApproval(params: RevokeApprovalParams): Promise<RevokeResult> {
  const { chainId, walletId, owner, tokenAddress, spender, approvalId } = params;

  const chainConfig = getChainById(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  await updateApprovalById(approvalId, { status: "revoking" });

  try {
    const privateKey = await derivePrivateKey(walletId);
    const account = privateKeyToAccount(privateKey);

    const walletClient = createWalletClient({
      account,
      chain: chainConfig.viemChain,
      transport: http(chainConfig.rpcUrl),
    });

    const publicClient = getPublicClient(chainId);

    const data = encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spender, 0n],
    });

    const gasEstimate = await publicClient.estimateGas({
      account: account.address,
      to: tokenAddress,
      data,
    });

    const feeData = await publicClient.estimateFeesPerGas();

    const hash = await walletClient.sendTransaction({
      chain: chainConfig.viemChain,
      to: tokenAddress,
      data,
      gas: gasEstimate + (gasEstimate / 5n),
      maxFeePerGas: feeData.maxFeePerGas || undefined,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    });

    await updateApprovalById(approvalId, { 
      status: "pending",
      revokeHash: hash,
    });

    const explorerUrl = getExplorerTxUrl(chainId, hash);

    waitForRevokeConfirmation(publicClient, hash, approvalId);

    return { hash, explorerUrl };
  } catch (error) {
    await updateApprovalById(approvalId, { status: "confirmed" });
    throw error;
  }
}

async function waitForRevokeConfirmation(
  publicClient: any,
  hash: `0x${string}`,
  approvalId: string
): Promise<void> {
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 120_000,
    });

    if (receipt.status === "success") {
      await updateApprovalById(approvalId, {
        status: "revoked",
        allowanceRaw: "0",
        allowanceFormatted: "0",
        isUnlimited: false,
        revokeHash: hash,
      });
    } else {
      await updateApprovalById(approvalId, { status: "failed" });
    }
  } catch (error) {
    console.error("[Revoke] Failed to confirm revoke:", error);
    await updateApprovalById(approvalId, { status: "confirmed" });
  }
}

export async function estimateRevokeFee(
  chainId: number,
  owner: `0x${string}`,
  tokenAddress: `0x${string}`,
  spender: `0x${string}`
): Promise<{ feeNative: string; feeFormatted: string; nativeSymbol: string }> {
  const chainConfig = getChainById(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const publicClient = getPublicClient(chainId);

  const data = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [spender, 0n],
  });

  const gasEstimate = await publicClient.estimateGas({
    account: owner,
    to: tokenAddress,
    data,
  });

  const feeData = await publicClient.estimateFeesPerGas();
  const maxFee = feeData.maxFeePerGas || 30000000000n;
  
  const totalFeeWei = gasEstimate * maxFee;
  const feeNative = formatEther(totalFeeWei);
  const feeNum = parseFloat(feeNative);

  let feeFormatted: string;
  if (feeNum < 0.0001) {
    feeFormatted = `< 0.0001 ${chainConfig.nativeSymbol}`;
  } else {
    feeFormatted = `~${feeNum.toFixed(4)} ${chainConfig.nativeSymbol}`;
  }

  return {
    feeNative,
    feeFormatted,
    nativeSymbol: chainConfig.nativeSymbol,
  };
}
