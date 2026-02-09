import React, { useState, useCallback, useEffect, useRef } from "react";
import { Alert } from "react-native";

import { useWalletConnect } from "@/lib/walletconnect/context";
import { useWallet } from "@/lib/wallet-context";
import { useCapAllowance, BlockedApprovalContext } from "@/lib/cap-allowance-context";
import { SessionApprovalSheet } from "@/components/SessionApprovalSheet";
import { SignRequestSheet } from "@/components/SignRequestSheet";
import { PinInputModal } from "@/components/PinInputModal";
import {
  PersonalSignRequest,
  SendTransactionRequest,
  SignTypedDataRequest,
  SolanaSignMessageRequest,
  SolanaSignTransactionRequest,
  SolanaSignAllTransactionsRequest,
} from "@/lib/walletconnect/handlers";
import {
  signPersonalMessage,
  sendRawTransaction,
  signTypedData,
  signSolanaMessage,
  signSolanaTransaction,
  signAllSolanaTransactions,
} from "@/lib/blockchain/transactions";
import { getERC20Decimals, getERC20Symbol } from "@/lib/blockchain/balances";
import { checkTransactionFirewall } from "@/lib/approvals/firewall";
import { decodeSolanaTransaction, decodeSolanaTransactions } from "@/lib/solana/decoder";

export function WalletConnectHandler({ children }: { children: React.ReactNode }) {
  const {
    currentProposal,
    currentRequest,
    sessions,
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
  const [isDrainerBlocked, setIsDrainerBlocked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const handleSignRef = useRef<() => void>();
  const [pendingApprovalData, setPendingApprovalData] = useState<{
    tokenAddress: `0x${string}`;
    spender: `0x${string}`;
    chainId: number;
    tokenDecimals: number;
    tokenSymbol: string;
  } | null>(null);

  useEffect(() => {
    if (!currentRequest || isCapSheetVisible) {
      setIsDrainerBlocked(false);
      return;
    }

    const { parsed } = currentRequest;
    
    const userPubkey = activeWallet?.addresses?.solana || "";
    
    if (parsed.method === "solana_signTransaction") {
      const solanaReq = parsed as SolanaSignTransactionRequest;
      if (solanaReq.transaction) {
        const decoded = decodeSolanaTransaction(solanaReq.transaction, { userPubkey, intent: "sign" });
        if (decoded.drainerDetection?.isBlocked) {
          console.warn("[WC] DRAINER BLOCKED:", decoded.drainerDetection.attackType);
          setIsDrainerBlocked(true);
          return;
        }
      }
    } else if (parsed.method === "solana_signAllTransactions") {
      const solanaReq = parsed as SolanaSignAllTransactionsRequest;
      if (solanaReq.transactions?.length > 0) {
        const decoded = decodeSolanaTransactions(solanaReq.transactions, { userPubkey, intent: "sign" });
        if (decoded.drainerDetection?.isBlocked) {
          console.warn("[WC] DRAINER BLOCKED in batch:", decoded.drainerDetection.attackType);
          setIsDrainerBlocked(true);
          return;
        }
      }
    }
    
    setIsDrainerBlocked(false);
    
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
    const hasEvm = !!activeWallet?.addresses?.evm;
    const hasSolana = !!activeWallet?.addresses?.solana;

    if (!hasEvm && !hasSolana) {
      Alert.alert("Error", "No wallet available");
      return;
    }

    setIsApproving(true);
    try {
      await approve({
        evm: (activeWallet!.addresses?.evm || "") as `0x${string}`,
        solana: activeWallet!.addresses?.solana,
      });
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
    if (!currentRequest || !activeWallet) {
      Alert.alert("Error", "No wallet available or no request pending");
      return;
    }

    // Ensure vault is actually unlocked before signing. The React isUnlocked
    // state can be stale (true) while cachedSecrets have been cleared from
    // memory due to memory pressure, hot reload, or app backgrounding.
    // ensureUnlocked() tries cached key first, then biometric prompt.
    // If all automatic recovery fails, show a PIN modal as fallback.
    try {
      const walletEngine = await import("@/lib/wallet-engine");
      const unlocked = await walletEngine.ensureUnlocked({ skipBiometric: true });
      if (!unlocked) {
        setPinError(null);
        setShowPinModal(true);
        return;
      }
    } catch (e: any) {
      // Non-lock error from import — let signing attempt proceed
      console.warn("[WC] Pre-sign unlock check error:", e);
    }

    if (isDrainerBlocked) {
      console.error("[WC] Attempted to sign blocked drainer transaction - aborting");
      await respondError("Transaction blocked: Wallet drainer detected");
      return;
    }

    setIsSigning(true);

    try {
      const { parsed, isSolana } = currentRequest;

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
      } else if (parsed.method === "eth_signTypedData" || parsed.method === "eth_signTypedData_v4") {
        const typedReq = parsed as SignTypedDataRequest;
        const signature = await signTypedData({
          walletId: activeWallet.id,
          typedData: typedReq.typedData as any,
        });
        await respondSuccess(signature);
      } else if (parsed.method === "solana_signMessage") {
        const solanaReq = parsed as SolanaSignMessageRequest;
        const signature = await signSolanaMessage({
          walletId: activeWallet.id,
          message: solanaReq.message,
        });
        // WalletConnect Solana expects { signature: "base58..." }
        await respondSuccess({ signature });
      } else if (parsed.method === "solana_signTransaction") {
        const solanaReq = parsed as SolanaSignTransactionRequest;
        const signedTx = await signSolanaTransaction({
          walletId: activeWallet.id,
          transaction: solanaReq.transaction,
        });
        // WalletConnect Solana expects { transaction: "base64..." }
        await respondSuccess({ transaction: signedTx });
      } else if (parsed.method === "solana_signAllTransactions") {
        const solanaReq = parsed as SolanaSignAllTransactionsRequest;
        const signedTxs = await signAllSolanaTransactions(
          activeWallet.id,
          solanaReq.transactions
        );
        // WalletConnect Solana expects { transactions: ["base64...", ...] }
        await respondSuccess({ transactions: signedTxs });
      } else {
        await respondError("Unsupported method");
      }
    } catch (err: any) {
      // If the signing itself throws a wallet-locked error (e.g. mnemonic not
      // found because secrets were evicted between ensureUnlocked and the
      // actual sign call), show the PIN modal instead of forwarding the error.
      if (err?.code === "WALLET_LOCKED" || err?.name === "WalletLockedError") {
        setIsSigning(false);
        setPinError(null);
        setShowPinModal(true);
        return;
      }
      const message = err instanceof Error ? err.message : "Signing failed";
      console.error("[WC] Sign error:", err);
      try {
        await respondError(message);
      } catch (respondErr) {
        // respondError already clears currentRequest in its finally block,
        // so just log the failure to send the error back to the dApp
        console.error("[WC] Failed to send error response to dApp:", respondErr);
      }
      Alert.alert("Signing Failed", message);
    } finally {
      setIsSigning(false);
    }
  }, [currentRequest, currentProposal, activeWallet, isUnlocked, isDrainerBlocked, respondSuccess, respondError]);

  // Keep ref in sync so PIN modal can retry signing without circular deps
  handleSignRef.current = handleSign;

  const handlePinSubmit = useCallback(async (pin: string) => {
    try {
      const { unlockWithPin } = await import("@/lib/wallet-engine");
      const success = await unlockWithPin(pin);
      if (success) {
        setShowPinModal(false);
        setPinError(null);
        // Retry signing now that vault is unlocked
        handleSignRef.current?.();
      } else {
        setPinError("Incorrect PIN. Please try again.");
      }
    } catch (e) {
      setPinError("Failed to unlock. Please try again.");
    }
  }, []);

  const handlePinCancel = useCallback(async () => {
    setShowPinModal(false);
    setPinError(null);
    try {
      await respondError("User cancelled unlock");
    } catch (err) {
      console.error("[WC] Failed to send cancel response:", err);
    }
  }, [respondError]);

  const handleRejectRequest = useCallback(async () => {
    try {
      await respondError("User rejected");
    } catch (err) {
      // respondError already clears currentRequest in its finally block,
      // so the sheet will close regardless. Just log the WC send failure.
      console.error("[WC] Reject request error:", err);
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
        // Reject the WC request so the dApp doesn't hang, then clean up local state
        respondError("User cancelled approval").catch((err) => {
          console.warn("[WC] Failed to send cancel response:", err);
        });
        setIsApprovalBlocked(false);
        setPendingApprovalData(null);
      },
    };

    showCapAllowanceSheet(capContext);
  }, [pendingApprovalData, currentRequest, activeWallet, policySettings, showCapAllowanceSheet, respondSuccess, respondError]);

  const getDappInfo = useCallback(() => {
    if (currentProposal) {
      const meta = currentProposal.params.proposer.metadata;
      return { 
        name: meta.name || "Unknown dApp", 
        url: meta.url || "",
        icons: meta.icons || [],
      };
    }
    if (currentRequest) {
      // Look up the session by topic to get real dApp metadata
      const session = sessions.find(s => s.topic === currentRequest.request.topic);
      if (session?.peerMeta) {
        return {
          name: session.peerMeta.name || "Unknown dApp",
          url: session.peerMeta.url || "",
          icons: session.peerMeta.icons || [],
        };
      }
      return { name: "Unknown dApp", url: "", icons: [] };
    }
    return { name: "Unknown dApp", url: "", icons: [] };
  }, [currentProposal, currentRequest, sessions]);

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
        dappIcon={dappInfo.icons[0]}
        isSigning={isSigning}
        isApprovalBlocked={isApprovalBlocked}
        isDrainerBlocked={isDrainerBlocked}
        onSign={handleSign}
        onReject={handleRejectRequest}
        onCapAllowance={handleCapAllowance}
      />
      <PinInputModal
        visible={showPinModal}
        title="Unlock Wallet"
        message="Your wallet session expired. Enter your PIN to continue signing."
        onSubmit={handlePinSubmit}
        onCancel={handlePinCancel}
        error={pinError}
      />
    </>
  );
}
