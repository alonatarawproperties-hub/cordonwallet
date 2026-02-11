import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import {
  initWalletConnect,
  getWeb3Wallet,
  getCore,
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
  shouldRejectProposalForDisabledChains,
} from "./client";
import { parseSessionRequest, ParsedRequest } from "./handlers";

interface WalletConnectContextType {
  isInitialized: boolean;
  isInitializing: boolean;
  error: string | null;
  sessions: WCSession[];
  currentProposal: SessionProposal | null;
  currentRequest: {
    request: SessionRequest;
    parsed: ParsedRequest;
    isSolana: boolean;
  } | null;
  evmRejectionReason: string | null;
  connect: (uri: string) => Promise<void>;
  approve: (addresses: MultiChainAddresses) => Promise<WCSession>;
  reject: () => Promise<void>;
  disconnect: (topic: string) => Promise<void>;
  respondSuccess: (result: unknown) => Promise<void>;
  respondError: (message?: string) => Promise<void>;
  refreshSessions: () => void;
  clearCurrentRequest: () => void;
  clearEvmRejection: () => void;
}

const WalletConnectContext = createContext<WalletConnectContextType | null>(
  null,
);

export function WalletConnectProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<WCSession[]>([]);
  const [currentProposal, setCurrentProposal] =
    useState<SessionProposal | null>(null);
  const [currentRequest, setCurrentRequest] = useState<{
    request: SessionRequest;
    parsed: ParsedRequest;
    isSolana: boolean;
  } | null>(null);
  const [evmRejectionReason, setEvmRejectionReason] = useState<string | null>(
    null,
  );
  const initPromiseRef = useRef<Promise<void> | null>(null);

  const listenersRegisteredRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const registerListeners = useCallback((wallet: any) => {
    if (listenersRegisteredRef.current) return;
    listenersRegisteredRef.current = true;

    wallet.on("session_proposal", async (proposal: any) => {
      const sessionProposal: SessionProposal = {
        id: proposal.id,
        params: proposal.params,
      };

      const rejection = shouldRejectProposalForDisabledChains(sessionProposal);
      if (rejection) {
        console.log("[WalletConnect] Rejecting proposal:", rejection.reason);
        try {
          await rejectSession(proposal.id);
        } catch (err) {
          console.warn("[WalletConnect] Error rejecting session:", err);
        }
        setEvmRejectionReason(rejection.reason);
        return;
      }

      setCurrentProposal(sessionProposal);
    });

    wallet.on("session_request", (event: any) => {
      console.log("[WalletConnect] session_request received:", event.params?.request?.method);
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
        setCurrentRequest((prev) => {
          if (prev) {
            console.warn("[WalletConnect] New request arrived while previous pending — rejecting old request");
            rejectRequest(
              prev.request.topic,
              prev.request.id,
              "Request superseded by a newer request"
            ).catch((err) => {
              console.warn("[WalletConnect] Failed to reject superseded request:", err);
            });
          }
          return {
            request: {
              id: event.id,
              topic: event.topic,
              params: event.params,
            },
            parsed,
            isSolana,
          };
        });
      } else {
        rejectRequest(
          event.topic,
          event.id,
          `Unsupported method: ${event.params.request.method}`
        );
      }
    });

    wallet.on("session_delete", (event: any) => {
      setSessions(getActiveSessions());
      setCurrentRequest((prev) => {
        if (prev && prev.request.topic === event.topic) {
          console.log("[WalletConnect] Clearing pending request for deleted session");
          return null;
        }
        return prev;
      });
    });
  }, []);

  // Check for pending requests that may have arrived while app was backgrounded
  const checkPendingRequests = useCallback(() => {
    const wallet = getWeb3Wallet();
    if (!wallet) return;

    try {
      const pendingRequests = wallet.getPendingSessionRequests();
      if (pendingRequests && pendingRequests.length > 0) {
        console.log(`[WalletConnect] Found ${pendingRequests.length} pending request(s)`);
        const latestRequest = pendingRequests[pendingRequests.length - 1];
        const chainIdStr = latestRequest.params.chainId;
        const chainId = parseChainId(chainIdStr);
        const isSolana = isSolanaChain(chainIdStr);

        const parsed = parseSessionRequest(
          latestRequest.params.request.method,
          latestRequest.params.request.params as unknown[],
          chainId,
          isSolana
        );

        if (parsed) {
          setCurrentRequest((prev) => {
            // Only set if we don't already have a request being processed
            if (prev) return prev;
            return {
              request: {
                id: latestRequest.id,
                topic: latestRequest.topic,
                params: latestRequest.params,
              },
              parsed,
              isSolana,
            };
          });
        }
      }
    } catch (err) {
      console.warn("[WalletConnect] Error checking pending requests:", err);
    }
  }, []);

  const initializeWC = useCallback(async () => {
    if (isInitialized) return;

    if (initPromiseRef.current) {
      await initPromiseRef.current;
      return;
    }

    let activeInitPromise: Promise<void> | null = null;
    const initPromise = (async () => {
      setIsInitializing(true);
      setError(null);

      try {
        const wallet = await initWalletConnect();

        // Register listeners immediately after wallet init
        registerListeners(wallet);

        setSessions(getActiveSessions());
        setIsInitialized(true);

        // Check for any pending requests that arrived before listeners were ready
        checkPendingRequests();
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Failed to initialize WalletConnect";
        setError(message);
        console.error("[WalletConnect] Init error:", err);
      } finally {
        setIsInitializing(false);
        if (initPromiseRef.current === activeInitPromise) {
          initPromiseRef.current = null;
        }
      }
    })();

    activeInitPromise = initPromise;
    initPromiseRef.current = initPromise;
    await initPromise;
  }, [isInitialized, registerListeners, checkPendingRequests]);

  // Handle app state changes - restart relay transport when app comes to foreground
  useEffect(() => {
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      const wasBackground = appStateRef.current.match(/inactive|background/);
      appStateRef.current = nextState;

      if (wasBackground && nextState === "active") {
        console.log("[WalletConnect] App returned to foreground, restarting relay transport");
        try {
          const coreInstance = getCore();
          if (coreInstance?.relayer) {
            // restartTransport closes and reopens the WebSocket connection
            await coreInstance.relayer.restartTransport();
            console.log("[WalletConnect] Relay transport restarted successfully");
          }
        } catch (err) {
          console.warn("[WalletConnect] Failed to restart relay transport:", err);
        }

        // Refresh sessions after reconnect
        setSessions(getActiveSessions());

        // Check for any pending requests that arrived while backgrounded
        // Small delay to allow relay to fully reconnect
        setTimeout(() => {
          checkPendingRequests();
        }, 500);
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => subscription.remove();
  }, [checkPendingRequests]);

  useEffect(() => {
    initializeWC();
  }, [initializeWC]);

  const connect = useCallback(
    async (uri: string) => {
      if (!isInitialized) {
        await initializeWC();
      }
      await pairWithUri(uri);
    },
    [isInitialized, initializeWC],
  );

  const approve = useCallback(
    async (addresses: MultiChainAddresses): Promise<WCSession> => {
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
        if (
          message.includes("deleted") ||
          message.includes("Missing or invalid")
        ) {
          console.warn(
            "[WalletConnect] Proposal was deleted or expired:",
            message,
          );
          setCurrentProposal(null);
          throw new Error(
            "Connection request expired. Please try connecting again.",
          );
        }
        throw err;
      }
    },
    [currentProposal],
  );

  const reject = useCallback(async () => {
    if (!currentProposal) {
      setCurrentProposal(null);
      return;
    }

    try {
      await rejectSession(currentProposal.id);
    } catch (err) {
      console.warn(
        "[WalletConnect] Error rejecting session (may be already deleted):",
        err,
      );
    }
    setCurrentProposal(null);
  }, [currentProposal]);

  const disconnect = useCallback(async (topic: string) => {
    await disconnectSession(topic);
    setSessions(getActiveSessions());
  }, []);

  const respondSuccess = useCallback(
    async (result: unknown) => {
      if (!currentRequest) {
        console.warn(
          "[WalletConnect] respondSuccess called with no current request",
        );
        return;
      }

      try {
        await respondToRequest(
          currentRequest.request.topic,
          currentRequest.request.id,
          result,
        );
      } catch (err) {
        console.error("[WalletConnect] Failed to send success response:", err);
      } finally {
        setCurrentRequest(null);
      }
    },
    [currentRequest],
  );

  const respondError = useCallback(
    async (message?: string) => {
      if (!currentRequest) {
        console.warn(
          "[WalletConnect] respondError called with no current request",
        );
        return;
      }

      try {
        await rejectRequest(
          currentRequest.request.topic,
          currentRequest.request.id,
          message,
        );
      } catch (err) {
        console.error("[WalletConnect] Failed to send error response:", err);
      } finally {
        setCurrentRequest(null);
      }
    },
    [currentRequest],
  );

  const refreshSessions = useCallback(() => {
    setSessions(getActiveSessions());
  }, []);

  const clearCurrentRequest = useCallback(() => {
    setCurrentRequest(null);
  }, []);

  const clearEvmRejection = useCallback(() => {
    setEvmRejectionReason(null);
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
        evmRejectionReason,
        connect,
        approve,
        reject,
        disconnect,
        respondSuccess,
        respondError,
        refreshSessions,
        clearCurrentRequest,
        clearEvmRejection,
      }}
    >
      {children}
    </WalletConnectContext.Provider>
  );
}

export function useWalletConnect() {
  const context = useContext(WalletConnectContext);
  if (!context) {
    throw new Error(
      "useWalletConnect must be used within WalletConnectProvider",
    );
  }
  return context;
}
