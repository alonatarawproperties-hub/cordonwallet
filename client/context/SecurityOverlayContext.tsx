import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import * as Haptics from "expo-haptics";

export type RiskLevel = "none" | "low" | "medium" | "high";

interface SecurityOverlayState {
  isVisible: boolean;
  riskLevel: RiskLevel;
  reason?: string;
}

interface SecurityOverlayContextType {
  state: SecurityOverlayState;
  showRiskAura: (options: { level: RiskLevel; reason?: string }) => void;
  hideRiskAura: () => void;
}

const SecurityOverlayContext = createContext<SecurityOverlayContextType | null>(null);

export function SecurityOverlayProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SecurityOverlayState>({
    isVisible: false,
    riskLevel: "none",
    reason: undefined,
  });

  const lastHighRiskTrigger = useRef<number>(0);

  const showRiskAura = useCallback(({ level, reason }: { level: RiskLevel; reason?: string }) => {
    const now = Date.now();
    
    if (level === "high" && now - lastHighRiskTrigger.current > 1000) {
      lastHighRiskTrigger.current = now;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    setState({
      isVisible: level !== "none",
      riskLevel: level,
      reason,
    });
  }, []);

  const hideRiskAura = useCallback(() => {
    setTimeout(() => {
      setState({
        isVisible: false,
        riskLevel: "none",
        reason: undefined,
      });
    }, 250);
  }, []);

  return (
    <SecurityOverlayContext.Provider value={{ state, showRiskAura, hideRiskAura }}>
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
