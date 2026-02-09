import React, { createContext, useContext, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DEV_SETTINGS_KEY = "@dev_settings";

interface DevSettings {
  simulateCordonBrowser: boolean;
}

interface DevSettingsContextValue {
  settings: DevSettings;
  updateSetting: <K extends keyof DevSettings>(key: K, value: DevSettings[K]) => Promise<void>;
  loadSettings: () => Promise<void>;
}

const defaultSettings: DevSettings = {
  simulateCordonBrowser: false,
};

const noopLoadSettings = async () => {};
const noopUpdateSetting = async () => {};

const prodContextValue: DevSettingsContextValue = {
  settings: defaultSettings,
  updateSetting: noopUpdateSetting as DevSettingsContextValue["updateSetting"],
  loadSettings: noopLoadSettings,
};

const DevSettingsContext = createContext<DevSettingsContextValue | null>(null);

export function DevSettingsProvider({ children }: { children: React.ReactNode }) {
  if (!__DEV__) {
    return (
      <DevSettingsContext.Provider value={prodContextValue}>
        {children}
      </DevSettingsContext.Provider>
    );
  }

  return <DevSettingsProviderDev>{children}</DevSettingsProviderDev>;
}

function DevSettingsProviderDev({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<DevSettings>(defaultSettings);

  const loadSettings = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(DEV_SETTINGS_KEY);
      if (stored) {
        setSettings({ ...defaultSettings, ...JSON.parse(stored) });
      }
    } catch (e) {
      console.error("[DevSettings] Failed to load:", e);
    }
  }, []);

  const updateSetting = useCallback(async <K extends keyof DevSettings>(
    key: K,
    value: DevSettings[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    try {
      await AsyncStorage.setItem(DEV_SETTINGS_KEY, JSON.stringify(newSettings));
    } catch (e) {
      console.error("[DevSettings] Failed to save:", e);
    }
  }, [settings]);

  return (
    <DevSettingsContext.Provider value={{ settings, updateSetting, loadSettings }}>
      {children}
    </DevSettingsContext.Provider>
  );
}

export function useDevSettings() {
  const context = useContext(DevSettingsContext);
  if (!context) {
    throw new Error("useDevSettings must be used within DevSettingsProvider");
  }
  return context;
}
