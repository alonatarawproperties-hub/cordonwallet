import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import * as Linking from "expo-linking";
import {
  startGoogleAuth,
  parseAuthCallback,
  validateAuthCallback,
  completeGoogleAuth,
  isRoachyAuthTrigger,
  extractReturnUrl,
  clearAuthState,
} from "@/services/externalAuth";

export type AuthStatus = "idle" | "starting" | "pending" | "exchanging" | "success" | "error";

interface ExternalAuthContextValue {
  status: AuthStatus;
  error: string | null;
  completionUrl: string | null;
  startAuth: (triggerUrl: string) => Promise<void>;
  handleDeepLink: (url: string) => Promise<boolean>;
  reset: () => void;
  isAuthTrigger: (url: string) => boolean;
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
      const result = await startGoogleAuth(returnUrl);

      if (!result.success) {
        setStatus("error");
        setError(result.error || "Failed to start authentication");
        authInProgress.current = false;
        return;
      }

      setStatus("pending");
    } catch (err: any) {
      setStatus("error");
      setError(err.message || "Failed to start authentication");
      authInProgress.current = false;
    }
  }, []);

  const handleDeepLink = useCallback(async (url: string): Promise<boolean> => {
    if (!url.startsWith("cordon://auth/callback")) {
      return false;
    }

    setStatus("exchanging");

    try {
      const params = parseAuthCallback(url);
      const validation = await validateAuthCallback(params);

      if (!validation.valid) {
        setStatus("error");
        setError(validation.error || "Invalid authentication response");
        authInProgress.current = false;
        return true;
      }

      const result = await completeGoogleAuth(params.code!);

      if (!result.success) {
        setStatus("error");
        setError(result.error || "Failed to complete authentication");
        authInProgress.current = false;
        return true;
      }

      setStatus("success");
      setCompletionUrl(result.completionUrl || null);
      authInProgress.current = false;
      return true;
    } catch (err: any) {
      setStatus("error");
      setError(err.message || "Authentication failed");
      authInProgress.current = false;
      return true;
    }
  }, []);

  const isAuthTrigger = useCallback((url: string): boolean => {
    return isRoachyAuthTrigger(url);
  }, []);

  useEffect(() => {
    const subscription = Linking.addEventListener("url", async (event) => {
      if (event.url.startsWith("cordon://auth/callback")) {
        await handleDeepLink(event.url);
      }
    });

    Linking.getInitialURL().then((url) => {
      if (url && url.startsWith("cordon://auth/callback")) {
        handleDeepLink(url);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [handleDeepLink]);

  return (
    <ExternalAuthContext.Provider
      value={{
        status,
        error,
        completionUrl,
        startAuth,
        handleDeepLink,
        reset,
        isAuthTrigger,
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
