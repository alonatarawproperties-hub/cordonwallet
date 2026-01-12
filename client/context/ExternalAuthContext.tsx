import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import {
  startGoogleAuth,
  isRoachyAuthTrigger,
  extractReturnUrl,
  clearAuthState,
  getAuthConfig,
} from "@/services/externalAuth";

export type AuthStatus = "idle" | "starting" | "pending" | "exchanging" | "success" | "error";

interface ExternalAuthContextValue {
  status: AuthStatus;
  error: string | null;
  completionUrl: string | null;
  startAuth: (triggerUrl: string) => Promise<void>;
  reset: () => void;
  isAuthTrigger: (url: string) => boolean;
  getConfig: () => { redirectUri: string; clientId: string; hasClientId: boolean; platform: string };
}

const ExternalAuthContext = createContext<ExternalAuthContextValue | null>(null);

export function ExternalAuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [completionUrl, setCompletionUrl] = useState<string | null>(null);
  const authInProgress = useRef(false);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setCompletionUrl(null);
    authInProgress.current = false;
    clearAuthState().catch(() => {});
  }, []);

  const startAuth = useCallback(async (triggerUrl: string) => {
    if (authInProgress.current) {
      return;
    }

    authInProgress.current = true;
    setStatus("starting");
    setError(null);
    setCompletionUrl(null);

    try {
      const returnUrl = extractReturnUrl(triggerUrl);
      
      setStatus("pending");
      
      const result = await startGoogleAuth(returnUrl);

      if (!result.success) {
        setStatus("error");
        setError(result.error || "Authentication failed");
        authInProgress.current = false;
        return;
      }

      if (result.completionUrl) {
        setStatus("success");
        setCompletionUrl(result.completionUrl);
      } else {
        setStatus("error");
        setError("No completion URL received");
      }
      
      authInProgress.current = false;
    } catch (err: any) {
      setStatus("error");
      setError(err.message || "Failed to complete authentication");
      authInProgress.current = false;
    }
  }, []);

  const isAuthTrigger = useCallback((url: string): boolean => {
    return isRoachyAuthTrigger(url);
  }, []);

  const getConfig = useCallback(() => {
    return getAuthConfig();
  }, []);

  return (
    <ExternalAuthContext.Provider
      value={{
        status,
        error,
        completionUrl,
        startAuth,
        reset,
        isAuthTrigger,
        getConfig,
      }}
    >
      {children}
    </ExternalAuthContext.Provider>
  );
}

export function useExternalAuth() {
  const context = useContext(ExternalAuthContext);
  if (!context) {
    throw new Error("useExternalAuth must be used within an ExternalAuthProvider");
  }
  return context;
}
