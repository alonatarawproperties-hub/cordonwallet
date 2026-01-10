import { useState, useCallback } from "react";
import { parseUnits } from "viem";

import { sendApproval, ApprovalPolicyError, TransactionResult } from "@/lib/blockchain/transactions";
import { CapAllowanceParams, CapAllowanceResult } from "@/components/CapAllowanceSheet";
import type { PolicySettings } from "@/lib/types";

export interface BlockedApprovalContext {
  chainId: number;
  walletId: string;
  tokenAddress: `0x${string}`;
  tokenSymbol: string;
  tokenName?: string;
  tokenDecimals: number;
  spender: `0x${string}`;
  ownerAddress: `0x${string}`;
  originalAmount: string;
  policySettings: PolicySettings;
  suggestedCap?: string;
}

export interface UseCapAllowanceReturn {
  isCapSheetVisible: boolean;
  capParams: CapAllowanceParams | null;
  blockedContext: BlockedApprovalContext | null;
  showCapSheet: (context: BlockedApprovalContext) => void;
  hideCapSheet: () => void;
  executeCappedApproval: (cappedAmount: bigint) => Promise<TransactionResult>;
}

export function useCapAllowance(): UseCapAllowanceReturn {
  const [isCapSheetVisible, setIsCapSheetVisible] = useState(false);
  const [capParams, setCapParams] = useState<CapAllowanceParams | null>(null);
  const [blockedContext, setBlockedContext] = useState<BlockedApprovalContext | null>(null);

  const showCapSheet = useCallback((context: BlockedApprovalContext) => {
    setBlockedContext(context);
    setCapParams({
      chainId: context.chainId,
      tokenAddress: context.tokenAddress,
      tokenSymbol: context.tokenSymbol,
      tokenName: context.tokenName,
      tokenDecimals: context.tokenDecimals,
      spender: context.spender,
      ownerAddress: context.ownerAddress,
      originalAmount: context.suggestedCap 
        ? BigInt(context.suggestedCap) 
        : undefined,
    });
    setIsCapSheetVisible(true);
  }, []);

  const hideCapSheet = useCallback(() => {
    setIsCapSheetVisible(false);
    setCapParams(null);
    setBlockedContext(null);
  }, []);

  const executeCappedApproval = useCallback(async (cappedAmount: bigint): Promise<TransactionResult> => {
    if (!blockedContext) {
      throw new Error("No blocked approval context");
    }

    const { formatUnits } = await import("viem");
    const cappedAmountFormatted = formatUnits(cappedAmount, blockedContext.tokenDecimals);

    const result = await sendApproval({
      chainId: blockedContext.chainId,
      walletId: blockedContext.walletId,
      tokenAddress: blockedContext.tokenAddress,
      tokenDecimals: blockedContext.tokenDecimals,
      tokenSymbol: blockedContext.tokenSymbol,
      tokenName: blockedContext.tokenName,
      spender: blockedContext.spender,
      amount: cappedAmountFormatted,
      policySettings: {
        ...blockedContext.policySettings,
        blockUnlimitedApprovals: false,
      },
    });

    hideCapSheet();
    return result;
  }, [blockedContext, hideCapSheet]);

  return {
    isCapSheetVisible,
    capParams,
    blockedContext,
    showCapSheet,
    hideCapSheet,
    executeCappedApproval,
  };
}

export async function sendApprovalWithCapFallback(params: {
  chainId: number;
  walletId: string;
  tokenAddress: `0x${string}`;
  tokenSymbol: string;
  tokenName?: string;
  tokenDecimals: number;
  spender: `0x${string}`;
  ownerAddress: `0x${string}`;
  amount: string;
  policySettings: PolicySettings;
  onBlocked: (context: BlockedApprovalContext) => void;
}): Promise<TransactionResult | null> {
  const { onBlocked, ownerAddress, ...approvalParams } = params;

  try {
    return await sendApproval(approvalParams);
  } catch (error) {
    if (error instanceof ApprovalPolicyError) {
      onBlocked({
        chainId: params.chainId,
        walletId: params.walletId,
        tokenAddress: params.tokenAddress,
        tokenSymbol: params.tokenSymbol,
        tokenName: params.tokenName,
        tokenDecimals: params.tokenDecimals,
        spender: params.spender,
        ownerAddress: params.ownerAddress,
        originalAmount: params.amount,
        policySettings: params.policySettings,
        suggestedCap: error.suggestedAmount,
      });
      return null;
    }
    throw error;
  }
}
