import React, { useState, useCallback, useEffect, useRef } from "react";
import { Alert } from "react-native";

import { useWalletConnect } from "@/lib/walletconnect/context";
import { useWallet } from "@/lib/wallet-context";
import { SessionApprovalSheet } from "@/components/SessionApprovalSheet";
import { SignRequestSheet } from "@/components/SignRequestSheet";
import { PinInputModal } from "@/components/PinInputModal";
import {
  SolanaSignMessageRequest,
  SolanaSignTransactionRequest,
  SolanaSignAndSendTransactionRequest,
  SolanaSignAllTransactionsRequest,
} from "@/lib/walletconnect/handlers";
import {
  signSolanaMessage,
  signSolanaTransaction,
  signAllSolanaTransactions,
} from "@/lib/solana/signing";
import { decodeSolanaTransaction, decodeSolanaTransactions } from "@/lib/solana/decoder";

export function WalletConnectHandler({
  children,
}: {
  children: React.ReactNode;
}) {
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

  const { activeWallet, isUnlocked } = useWallet();

  const [isSigning, setIsSigning] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isDrainerBlocked, setIsDrainerBlocked] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const handleSignRef = useRef<() => void>();

  useEffect(() => {
    if (!currentRequest) {
      setIsDrainerBlocked(false);
      return;
    }

    const { parsed } = currentRequest;

    const userPubkey = activeWallet?.addresses?.solana || "";

    if (parsed.method === "solana_signTransaction") {
      const solanaReq = parsed as SolanaSignTransactionRequest;
      if (solanaReq.transaction) {
        const decoded = decodeSolanaTransaction(solanaReq.transaction, {
          userPubkey,
          intent: "sign",
        });
        if (decoded.drainerDetection?.isBlocked) {
          console.warn(
            "[WC] DRAINER BLOCKED:",
            decoded.drainerDetection.attackType,
          );
          setIsDrainerBlocked(true);
          return;
        }
      }
    } else if (parsed.method === "solana_signAllTransactions") {
      const solanaReq = parsed as SolanaSignAllTransactionsRequest;
      if (solanaReq.transactions?.length > 0) {
        const decoded = decodeSolanaTransactions(solanaReq.transactions, {
          userPubkey,
          intent: "sign",
        });
        if (decoded.drainerDetection?.isBlocked) {
          console.warn(
            "[WC] DRAINER BLOCKED in batch:",
            decoded.drainerDetection.attackType,
          );
          setIsDrainerBlocked(true);
          return;
        }
      }
    }

    setIsDrainerBlocked(false);
  }, [currentRequest]);

  const handleApproveSession = useCallback(async () => {
    const hasSolana = !!activeWallet?.addresses?.solana;

    if (!hasSolana) {
      Alert.alert("Error", "No wallet available");
      return;
    }

    setIsApproving(true);
    try {
      await approve({
        evm: "" as `0x${string}`,
        solana: activeWallet!.addresses?.solana,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to approve session";
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

    try {
      const walletEngine = await import("@/lib/wallet-engine");
      const unlocked = await walletEngine.ensureUnlocked({
        skipBiometric: true,
      });
      if (!unlocked) {
        setPinError(null);
        setShowPinModal(true);
        return;
      }
    } catch (e: any) {
      console.warn("[WC] Pre-sign unlock check error:", e);
    }

    if (isDrainerBlocked) {
      console.error(
        "[WC] Attempted to sign blocked drainer transaction - aborting",
      );
      await respondError("Transaction blocked: Wallet drainer detected");
      return;
    }

    setIsSigning(true);

    try {
      const { parsed } = currentRequest;

      if (parsed.method === "solana_signMessage") {
        const solanaReq = parsed as SolanaSignMessageRequest;
        const signature = await signSolanaMessage({
          walletId: activeWallet.id,
          message: solanaReq.message,
        });
        await respondSuccess({ signature });
      } else if (parsed.method === "solana_signTransaction") {
        const solanaReq = parsed as
          | SolanaSignTransactionRequest
          | SolanaSignAndSendTransactionRequest;
        const signedTx = await signSolanaTransaction({
          walletId: activeWallet.id,
          transaction: solanaReq.transaction,
        });
        await respondSuccess({ transaction: signedTx });
      } else if (parsed.method === "solana_signAndSendTransaction") {
        const solanaReq = parsed as SolanaSignAndSendTransactionRequest;
        const signedTx = await signSolanaTransaction({
          walletId: activeWallet.id,
          transaction: solanaReq.transaction,
        });

        const sendUrl = new URL(
          "/api/solana/send-raw-transaction",
          getApiUrl(),
        );
        const response = await fetch(sendUrl.toString(), {
          method: "POST",
          headers: getApiHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ transactionBase64: signedTx }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err?.error || "Failed to broadcast transaction");
        }

        const data = await response.json();
        await respondSuccess({ signature: data.signature });
      } else if (parsed.method === "solana_signAllTransactions") {
        const solanaReq = parsed as SolanaSignAllTransactionsRequest;
        const signedTxs = await signAllSolanaTransactions(
          activeWallet.id,
          solanaReq.transactions,
        );
        await respondSuccess({ transactions: signedTxs });
      } else {
        await respondError("Unsupported method");
      }
    } catch (err: any) {
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
        console.error("[WC] Failed to send error response to dApp:", respondErr);
      }
      Alert.alert("Signing Failed", message);
    } finally {
      setIsSigning(false);
    }
  }, [
    currentRequest,
    currentProposal,
    activeWallet,
    isUnlocked,
    isDrainerBlocked,
    respondSuccess,
    respondError,
  ]);

  handleSignRef.current = handleSign;

  const handlePinSubmit = useCallback(async (pin: string) => {
    try {
      const { unlockWithPin } = await import("@/lib/wallet-engine");
      const success = await unlockWithPin(pin);
      if (success) {
        setShowPinModal(false);
        setPinError(null);
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
    setIsSigning(false);
    try {
      await respondError("User cancelled unlock");
    } catch (err) {
      console.error("[WC] Failed to send cancel response:", err);
    }
  }, [respondError]);

  const handleRejectRequest = useCallback(async () => {
    setIsSigning(false);
    try {
      await respondError("User rejected");
    } catch (err) {
      console.error("[WC] Reject request error:", err);
    }
  }, [respondError]);

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
  const showSignSheet = !!currentRequest;

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
        isDrainerBlocked={isDrainerBlocked}
        onSign={handleSign}
        onReject={handleRejectRequest}
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
