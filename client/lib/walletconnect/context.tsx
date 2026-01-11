import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import {
  initWalletConnect,
  getWeb3Wallet,
  pairWithUri,
  approveSession,
  rejectSession,
  disconnectSession,
  getActiveSessions,
  respondToRequest,
  rejectRequest,
  parseChainId,
  isSolanaChain,
  WCSession,
  SessionProposal,
  SessionRequest,
  MultiChainAddresses,
} from "./client";
import { parseSessionRequest, ParsedRequest } from "./handlers";

interface WalletConnectContextType {
  isInitialized: boolean;
  isInitializing: boolean;
  error: string | null;
  sessions: WCSession[];
  currentProposal: SessionProposal | null;
  currentRequest: { request: SessionRequest; parsed: ParsedRequest; isSolana: boolean } | null;
  connect: (uri: string) => Promise<void>;
  approve: (addresses: MultiChainAddresses) => Promise<WCSession>;
  reject: () => Promise<void>;
  disconnect: (topic: string) => Promise<void>;
  respondSuccess: (result: unknown) => Promise<void>;
  respondError: (message?: string) => Promise<void>;
  refreshSessions: () => void;
  clearCurrentRequest: () => void;
}

const WalletConnectContext = createContext<WalletConnectContextType | null>(null);

export function WalletConnectProvider({ children }: { children: React.ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<WCSession[]>([]);
  const [currentProposal, setCurrentProposal] = useState<SessionProposal | null>(null);
  const [currentRequest, setCurrentRequest] = useState<{
    request: SessionRequest;
    parsed: ParsedRequest;
    isSolana: boolean;
  } | null>(null);

  const initializeWC = useCallback(async () => {
    if (isInitialized || isInitializing) return;

    setIsInitializing(true);
    setError(null);

    try {
      const wallet = await initWalletConnect();

      wallet.on("session_proposal", (proposal) => {
        setCurrentProposal({
          id: proposal.id,
          params: proposal.params,
        });
      });

      wallet.on("session_request", (event) => {
        const chainIdStr = event.params.chainId;
        const chainId = parseChainId(chainIdStr);
        const isSolana = isSolanaChain(chainIdStr);
        
        const parsed = parseSessionRequest(
          event.params.request.method,
          event.params.request.params as unknown[],
          chainId,
          isSolana
        );

        if (parsed) {
          setCurrentRequest({
            request: {
              id: event.id,
              topic: event.topic,
              params: event.params,
            },
            parsed,
            isSolana,
          });
        } else {
          rejectRequest(
            event.topic,
            event.id,
            `Unsupported method: ${event.params.request.method}`
          );
        }
      });

      wallet.on("session_delete", () => {
        setSessions(getActiveSessions());
      });

      setSessions(getActiveSessions());
      setIsInitialized(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to initialize WalletConnect";
      setError(message);
      console.error("[WalletConnect] Init error:", err);
    } finally {
      setIsInitializing(false);
    }
  }, [isInitialized, isInitializing]);

  useEffect(() => {
    initializeWC();
  }, []);

  const connect = useCallback(async (uri: string) => {
    if (!isInitialized) {
      await initializeWC();
    }
    await pairWithUri(uri);
  }, [isInitialized, initializeWC]);

  const approve = useCallback(async (addresses: MultiChainAddresses): Promise<WCSession> => {
    if (!currentProposal) {
      throw new Error("No proposal to approve");
    }

    const proposalToApprove = currentProposal;
    
    try {
      const session = await approveSession(proposalToApprove, addresses);
      setSessions(getActiveSessions());
      setCurrentProposal(null);
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("deleted") || message.includes("Missing or invalid")) {
        console.warn("[WalletConnect] Proposal was deleted or expired:", message);
        setCurrentProposal(null);
        throw new Error("Connection request expired. Please try connecting again.");
      }
      throw err;
    }
  }, [currentProposal]);

  const reject = useCallback(async () => {
    if (!currentProposal) {
      setCurrentProposal(null);
      return;
    }

    try {
      await rejectSession(currentProposal.id);
    } catch (err) {
      console.warn("[WalletConnect] Error rejecting session (may be already deleted):", err);
    }
    setCurrentProposal(null);
  }, [currentProposal]);

  const disconnect = useCallback(async (topic: string) => {
    await disconnectSession(topic);
    setSessions(getActiveSessions());
  }, []);

  const respondSuccess = useCallback(async (result: unknown) => {
    if (!currentRequest) {
      throw new Error("No request to respond to");
    }

    await respondToRequest(
      currentRequest.request.topic,
      currentRequest.request.id,
      result
    );
    setCurrentRequest(null);
  }, [currentRequest]);

  const respondError = useCallback(async (message?: string) => {
    if (!currentRequest) {
      throw new Error("No request to respond to");
    }

    await rejectRequest(
      currentRequest.request.topic,
      currentRequest.request.id,
      message
    );
    setCurrentRequest(null);
  }, [currentRequest]);

  const refreshSessions = useCallback(() => {
    setSessions(getActiveSessions());
  }, []);

  const clearCurrentRequest = useCallback(() => {
    setCurrentRequest(null);
  }, []);

  return (
    <WalletConnectContext.Provider
      value={{
        isInitialized,
        isInitializing,
        error,
        sessions,
        currentProposal,
        currentRequest,
        connect,
        approve,
        reject,
        disconnect,
        respondSuccess,
        respondError,
        refreshSessions,
        clearCurrentRequest,
      }}
    >
      {children}
    </WalletConnectContext.Provider>
  );
}

export function useWalletConnect() {
  const context = useContext(WalletConnectContext);
  if (!context) {
    throw new Error("useWalletConnect must be used within WalletConnectProvider");
  }
  return context;
}
