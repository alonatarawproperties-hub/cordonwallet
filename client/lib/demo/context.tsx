import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DEMO_MODE_KEY = "@cordon/demo_mode";

interface DemoContextValue {
  isDemoMode: boolean;
  toggleDemoMode: () => Promise<void>;
  setDemoMode: (value: boolean) => Promise<void>;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [isDemoMode, setIsDemoMode] = useState(false);

  const setDemoMode = useCallback(async (value: boolean) => {
    setIsDemoMode(value);
    await AsyncStorage.setItem(DEMO_MODE_KEY, JSON.stringify(value));
  }, []);

  const toggleDemoMode = useCallback(async () => {
    const newValue = !isDemoMode;
    await setDemoMode(newValue);
  }, [isDemoMode, setDemoMode]);

  React.useEffect(() => {
    AsyncStorage.getItem(DEMO_MODE_KEY).then((stored) => {
      if (stored) {
        setIsDemoMode(JSON.parse(stored));
      }
    });
  }, []);

  return (
    <DemoContext.Provider value={{ isDemoMode, toggleDemoMode, setDemoMode }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) {
    throw new Error("useDemo must be used within a DemoProvider");
  }
  return context;
}
