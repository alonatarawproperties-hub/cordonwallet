import React, { useState, useCallback, useEffect } from "react";
import { Alert } from "react-native";

import { useWalletConnect } from "@/lib/walletconnect/context";
import { useWallet } from "@/lib/wallet-context";
import { useCapAllowance, BlockedApprovalContext } from "@/lib/cap-allowance-context";
import { SessionApprovalSheet } from "@/components/SessionApprovalSheet";
import { SignRequestSheet } from "@/components/SignRequestSheet";
import { PersonalSignRequest, SendTransactionRequest } from "@/lib/walletconnect/handlers";
import { signPersonalMessage, sendRawTransaction } from "@/lib/blockchain/transactions";
import { getERC20Decimals, getERC20Symbol } from "@/lib/blockchain/balances";
import { checkTransactionFirewall } from "@/lib/approvals/firewall";

export function WalletConnectHandler({ children }: { children: React.ReactNode }) {
  const {
    currentProposal,
    currentRequest,
    approve,
    reject,
    respondSuccess,
    respondError,
    clearCurrentRequest,
  } = useWalletConnect();

  const { activeWallet, isUnlocked, policySettings } = useWallet();
  const { showCapAllowanceSheet, isCapSheetVisible } = useCapAllowance();

  const [isSigning, setIsSigning] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isApprovalBlocked, setIsApprovalBlocked] = useState(false);
  const [pendingApprovalData, setPendingApprovalData] = useState<{
    tokenAddress: `0x${string}`;
    spender: `0x${string}`;
    chainId: number;
    tokenDecimals: number;
    tokenSymbol: string;
  } | null>(null);

  useEffect(() => {
    if (!currentRequest || isCapSheetVisible) {
      return;
    }

    const { parsed } = currentRequest;
    if (parsed.method === "eth_sendTransaction") {
      const txRequest = parsed as SendTransactionRequest;
      
      const firewallResult = checkTransactionFirewall({
        chainId: txRequest.chainId,
        to: txRequest.tx.to as `0x${string}`,
        data: txRequest.tx.data as `0x${string}` | undefined,
        policySettings,
      });

      if (!firewallResult.allowed && firewallResult.isApproval && firewallResult.approval) {
        const tokenAddress = txRequest.tx.to as `0x${string}`;
        const chainId = txRequest.chainId;
        
        setIsApprovalBlocked(true);
        setPendingApprovalData({
          tokenAddress,
          spender: firewallResult.approval.spender,
          chainId,
          tokenDecimals: 18,
          tokenSymbol: "Token",
        });

        (async () => {
          try {
            const [decimals, symbol] = await Promise.all([
              getERC20Decimals(tokenAddress, chainId),
              getERC20Symbol(tokenAddress, chainId),
            ]);
            
            setPendingApprovalData((prev) => {
              if (!prev || prev.tokenAddress !== tokenAddress) return prev;
              return {
                ...prev,
                tokenDecimals: decimals ?? 18,
                tokenSymbol: symbol ?? "Token",
              };
            });
          } catch (err) {
            console.error("[WC] Failed to fetch token metadata:", err);
          }
        })();
        
        return;
      }
    }
    
    setIsApprovalBlocked(false);
    setPendingApprovalData(null);
  }, [currentRequest, policySettings, isCapSheetVisible]);

  const handleApproveSession = useCallback(async () => {
    if (!activeWallet?.addresses?.evm) {
      Alert.alert("Error", "No wallet available");
      return;
    }

    setIsApproving(true);
    try {
      await approve(activeWallet.addresses.evm as `0x${string}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to approve session";
      Alert.alert("Error", message);
    } finally {
      setIsApproving(false);
    }
  }, [approve, activeWallet]);

  const handleRejectSession = useCallback(async () => {
    try {
      await reject();
    } catch (err) {
      console.error("Reject session error:", err);
    }
  }, [reject]);

  const handleSign = useCallback(async () => {
    if (!currentRequest || !activeWallet || !isUnlocked) {
      Alert.alert("Error", "Wallet is locked or no request pending");
      return;
    }

    setIsSigning(true);

    try {
      const { parsed } = currentRequest;

      if (parsed.method === "personal_sign") {
        const signReq = parsed as PersonalSignRequest;
        const signature = await signPersonalMessage({
          walletId: activeWallet.id,
          message: signReq.messageHex,
        });
        await respondSuccess(signature);
      } else if (parsed.method === "eth_sendTransaction") {
        const txReq = parsed as SendTransactionRequest;
        const result = await sendRawTransaction({
          chainId: txReq.chainId,
          walletId: activeWallet.id,
          to: txReq.tx.to as `0x${string}`,
          value: txReq.tx.value ? BigInt(txReq.tx.value) : 0n,
          data: txReq.tx.data as `0x${string}` | undefined,
          gas: txReq.tx.gas ? BigInt(txReq.tx.gas) : undefined,
        });
        await respondSuccess(result.hash);
      } else {
        await respondError("Unsupported method");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Signing failed";
      console.error("[WC] Sign error:", err);
      await respondError(message);
      Alert.alert("Signing Failed", message);
    } finally {
      setIsSigning(false);
    }
  }, [currentRequest, activeWallet, isUnlocked, respondSuccess, respondError]);

  const handleRejectRequest = useCallback(async () => {
    try {
      await respondError("User rejected");
    } catch (err) {
      console.error("Reject request error:", err);
    }
  }, [respondError]);

  const handleCapAllowance = useCallback(() => {
    if (!pendingApprovalData || !currentRequest || !activeWallet?.addresses?.evm) return;

    const capContext: BlockedApprovalContext = {
      chainId: pendingApprovalData.chainId,
      walletId: activeWallet.id,
      tokenAddress: pendingApprovalData.tokenAddress,
      tokenSymbol: pendingApprovalData.tokenSymbol,
      tokenDecimals: pendingApprovalData.tokenDecimals,
      spender: pendingApprovalData.spender,
      ownerAddress: activeWallet.addresses.evm as `0x${string}`,
      originalAmount: "unlimited",
      policySettings,
      onSuccess: async (txResult) => {
        await respondSuccess(txResult.hash);
        setIsApprovalBlocked(false);
        setPendingApprovalData(null);
      },
      onCancel: () => {
        clearCurrentRequest();
        setIsApprovalBlocked(false);
        setPendingApprovalData(null);
      },
    };

    showCapAllowanceSheet(capContext);
  }, [pendingApprovalData, currentRequest, activeWallet, policySettings, showCapAllowanceSheet, respondSuccess, clearCurrentRequest]);

  const getDappInfo = () => {
    if (currentProposal) {
      const meta = currentProposal.params.proposer.metadata;
      return { name: meta.name, url: meta.url };
    }
    return { name: "dApp", url: "" };
  };

  const dappInfo = getDappInfo();
  const showSignSheet = !!currentRequest && !isCapSheetVisible;

  return (
    <>
      {children}
      <SessionApprovalSheet
        visible={!!currentProposal}
        proposal={currentProposal}
        isApproving={isApproving}
        onApprove={handleApproveSession}
        onReject={handleRejectSession}
      />
      <SignRequestSheet
        visible={showSignSheet}
        request={currentRequest}
        dappName={dappInfo.name}
        dappUrl={dappInfo.url}
        isSigning={isSigning}
        isApprovalBlocked={isApprovalBlocked}
        onSign={handleSign}
        onReject={handleRejectRequest}
        onCapAllowance={handleCapAllowance}
      />
    </>
  );
}
