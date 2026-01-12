import React, { createContext, useContext, useState, useCallback, useRef, useMemo } from "react";
import * as Haptics from "expo-haptics";

export type RiskLevel = "none" | "low" | "medium" | "high";

export interface RiskPayload {
  level: RiskLevel;
  reason?: string;
  chain?: string;
  action?: string;
  details?: Record<string, unknown>;
}

interface SecurityOverlayState {
  isVisible: boolean;
  riskLevel: RiskLevel;
  reason?: string;
  chain?: string;
  action?: string;
  details?: Record<string, unknown>;
}

interface SecurityOverlayContextType {
  state: SecurityOverlayState;
  showRiskAura: (payload: RiskPayload) => void;
  hideRiskAura: () => void;
  acknowledgeRisk: () => void;
}

const SecurityOverlayContext = createContext<SecurityOverlayContextType | null>(null);

const INITIAL_STATE: SecurityOverlayState = {
  isVisible: false,
  riskLevel: "none",
  reason: undefined,
  chain: undefined,
  action: undefined,
  details: undefined,
};

function payloadsEqual(a: RiskPayload | null, b: RiskPayload): boolean {
  if (!a) return false;
  const detailsMatch = JSON.stringify(a.details) === JSON.stringify(b.details);
  return (
    a.level === b.level &&
    a.reason === b.reason &&
    a.chain === b.chain &&
    a.action === b.action &&
    detailsMatch
  );
}

export function SecurityOverlayProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SecurityOverlayState>(INITIAL_STATE);
  const lastPayloadRef = useRef<RiskPayload | null>(null);
  const lastHighRiskHapticRef = useRef<number>(0);
  const acknowledgedRef = useRef<boolean>(false);

  const showRiskAura = useCallback((payload: RiskPayload) => {
    if (payloadsEqual(lastPayloadRef.current, payload)) {
      return;
    }

    lastPayloadRef.current = payload;
    acknowledgedRef.current = false;

    const now = Date.now();
    if (payload.level === "high" && now - lastHighRiskHapticRef.current > 1000) {
      lastHighRiskHapticRef.current = now;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    setState({
      isVisible: payload.level !== "none",
      riskLevel: payload.level,
      reason: payload.reason,
      chain: payload.chain,
      action: payload.action,
      details: payload.details,
    });
  }, []);

  const hideRiskAura = useCallback(() => {
    lastPayloadRef.current = null;
    acknowledgedRef.current = false;
    setState(INITIAL_STATE);
  }, []);

  const acknowledgeRisk = useCallback(() => {
    acknowledgedRef.current = true;
    lastPayloadRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const value = useMemo(() => ({
    state,
    showRiskAura,
    hideRiskAura,
    acknowledgeRisk,
  }), [state, showRiskAura, hideRiskAura, acknowledgeRisk]);

  return (
    <SecurityOverlayContext.Provider value={value}>
      {children}
    </SecurityOverlayContext.Provider>
  );
}

export function useSecurityOverlay() {
  const context = useContext(SecurityOverlayContext);
  if (!context) {
    throw new Error("useSecurityOverlay must be used within SecurityOverlayProvider");
  }
  return context;
}
