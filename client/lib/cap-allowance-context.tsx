import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { Alert } from "react-native";

import { CapAllowanceSheet, CapAllowanceParams, CapAllowanceResult } from "@/components/CapAllowanceSheet";
import { sendApproval, ApprovalPolicyError, TransactionResult } from "@/lib/blockchain/transactions";
import { detectApproveIntent, DetectedApproval, MAX_UINT256 } from "@/lib/approvals";
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
  onSuccess?: (result: TransactionResult) => void;
  onCancel?: () => void;
}

interface CapAllowanceContextType {
  showCapAllowanceSheet: (context: BlockedApprovalContext) => void;
  isCapSheetVisible: boolean;
}

const CapAllowanceContext = createContext<CapAllowanceContextType | undefined>(undefined);

export function CapAllowanceProvider({ children }: { children: ReactNode }) {
  const [isCapSheetVisible, setIsCapSheetVisible] = useState(false);
  const [capParams, setCapParams] = useState<CapAllowanceParams | null>(null);
  const [blockedContext, setBlockedContext] = useState<BlockedApprovalContext | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showCapAllowanceSheet = useCallback((context: BlockedApprovalContext) => {
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
    const ctx = blockedContext;
    setBlockedContext(null);
    ctx?.onCancel?.();
  }, [blockedContext]);

  const handleConfirm = useCallback(async (result: CapAllowanceResult) => {
    if (!blockedContext || isSubmitting) return;

    setIsSubmitting(true);

    try {
      const cappedAmountFormatted = (result.cappedAmount / (10n ** BigInt(blockedContext.tokenDecimals))).toString();

      const txResult = await sendApproval({
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

      setIsCapSheetVisible(false);
      setCapParams(null);
      const ctx = blockedContext;
      setBlockedContext(null);
      
      ctx?.onSuccess?.(txResult);
    } catch (error: any) {
      Alert.alert("Transaction Failed", error.message || "Failed to submit capped approval");
    } finally {
      setIsSubmitting(false);
    }
  }, [blockedContext, isSubmitting]);

  return (
    <CapAllowanceContext.Provider value={{ showCapAllowanceSheet, isCapSheetVisible }}>
      {children}
      <CapAllowanceSheet
        visible={isCapSheetVisible}
        params={capParams}
        onConfirm={handleConfirm}
        onCancel={hideCapSheet}
      />
    </CapAllowanceContext.Provider>
  );
}

export function useCapAllowance() {
  const context = useContext(CapAllowanceContext);
  if (context === undefined) {
    throw new Error("useCapAllowance must be used within a CapAllowanceProvider");
  }
  return context;
}

export interface WalletConnectApproveRequest {
  chainId: number;
  from: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value?: string;
}

export interface WalletConnectFirewallResult {
  blocked: boolean;
  isApproval: boolean;
  approval?: DetectedApproval;
  reason?: string;
  suggestedCap?: bigint;
}

export function checkWalletConnectApprove(
  request: WalletConnectApproveRequest,
  policySettings: PolicySettings
): WalletConnectFirewallResult {
  const { to, data } = request;

  if (!data || data === "0x" || data.length < 10) {
    return { blocked: false, isApproval: false };
  }

  const selector = data.slice(0, 10).toLowerCase();
  
  if (selector !== "0x095ea7b3") {
    return { blocked: false, isApproval: false };
  }

  const approval = detectApproveIntent(to, data);
  
  if (!approval) {
    return { blocked: false, isApproval: false };
  }

  if (policySettings.denylistedAddresses.some(
    addr => addr.toLowerCase() === approval.spender.toLowerCase()
  )) {
    return {
      blocked: true,
      isApproval: true,
      approval,
      reason: "Spender is on your denylist",
    };
  }

  if (policySettings.allowlistedAddresses.some(
    addr => addr.toLowerCase() === approval.spender.toLowerCase()
  )) {
    return { blocked: false, isApproval: true, approval };
  }

  if (approval.isUnlimited && policySettings.blockUnlimitedApprovals) {
    const maxSpendUsd = parseFloat(policySettings.maxSpendPerTransaction) || 1000;
    const estimatedTokensForMaxSpend = maxSpendUsd * 10;
    const suggestedCap = BigInt(Math.floor(estimatedTokensForMaxSpend)) * (10n ** 18n);
    
    return {
      blocked: true,
      isApproval: true,
      approval,
      reason: "Unlimited approval blocked by policy",
      suggestedCap,
    };
  }

  return { blocked: false, isApproval: true, approval };
}

export function modifyApproveCalldata(
  originalData: `0x${string}`,
  newAmount: bigint
): `0x${string}` {
  if (originalData.length < 10 + 64 + 64) {
    throw new Error("Invalid approve calldata");
  }

  const selector = originalData.slice(0, 10);
  const spenderPadded = originalData.slice(10, 74);
  const newAmountHex = newAmount.toString(16).padStart(64, "0");

  return `${selector}${spenderPadded}${newAmountHex}` as `0x${string}`;
}
