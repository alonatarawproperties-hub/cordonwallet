import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Wallet, Bundle, NetworkId, PolicySettings, Transaction, Approval, TokenBalance } from "./types";
import { listWallets, getActiveWallet, setActiveWalletById, renameWallet as renameWalletEngine, WalletRecord } from "./wallet-engine";
import { resetPortfolioCache } from "./portfolio-cache";

interface WalletContextType {
  isInitialized: boolean;
  isUnlocked: boolean;
  hasWallet: boolean;
  activeWallet: Wallet | null;
  wallets: Wallet[];
  bundles: Bundle[];
  selectedNetwork: NetworkId;
  policySettings: PolicySettings;
  balances: TokenBalance[];
  transactions: Transaction[];
  approvals: Approval[];
  portfolioRefreshNonce: number;
  setActiveWallet: (wallet: Wallet | null) => Promise<void>;
  setSelectedNetwork: (networkId: NetworkId) => void;
  addWallet: (wallet: Wallet) => Promise<void>;
  removeWallet: (walletId: string) => Promise<void>;
  renameWallet: (walletId: string, newName: string) => Promise<void>;
  addBundle: (bundle: Bundle) => Promise<void>;
  removeBundle: (bundleId: string) => Promise<void>;
  updatePolicySettings: (settings: Partial<PolicySettings>) => Promise<void>;
  unlock: () => void;
  lock: () => void;
  logout: () => Promise<void>;
  refreshWallets: () => Promise<void>;
  resetWalletState: () => void;
}

const defaultPolicySettings: PolicySettings = {
  blockUnlimitedApprovals: true,
  maxSpendPerTransaction: "1000",
  dailySpendLimit: "5000",
  allowlistedAddresses: [],
  denylistedAddresses: [],
};

const STORAGE_KEYS = {
  BUNDLES: "@cordon/bundles",
  POLICY_SETTINGS: "@cordon/policy_settings",
  SELECTED_NETWORK: "@cordon/selected_network",
};

function walletRecordToWallet(record: WalletRecord): Wallet {
  return {
    id: record.id,
    name: record.name,
    address: record.address,
    addresses: record.addresses,
    createdAt: record.createdAt,
  };
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [activeWallet, setActiveWalletState] = useState<Wallet | null>(null);
  const [selectedNetwork, setSelectedNetworkState] = useState<NetworkId>("polygon");
  const [policySettings, setPolicySettings] = useState<PolicySettings>(defaultPolicySettings);
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [portfolioRefreshNonce, setPortfolioRefreshNonce] = useState(0);

  const refreshWallets = useCallback(async () => {
    try {
      const walletRecords = await listWallets();
      const loadedWallets = walletRecords.map(walletRecordToWallet);
      setWallets(loadedWallets);
      setHasWallet(loadedWallets.length > 0);

      const activeRecord = await getActiveWallet();
      if (activeRecord) {
        setActiveWalletState(walletRecordToWallet(activeRecord));
      } else if (loadedWallets.length > 0) {
        setActiveWalletState(loadedWallets[0]);
      }
    } catch (error) {
      console.error("Failed to refresh wallets:", error);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [bundlesJson, policyJson, networkId] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.BUNDLES),
        AsyncStorage.getItem(STORAGE_KEYS.POLICY_SETTINGS),
        AsyncStorage.getItem(STORAGE_KEYS.SELECTED_NETWORK),
      ]);

      const walletRecords = await listWallets();
      const loadedWallets = walletRecords.map(walletRecordToWallet);
      let loadedBundles: Bundle[] = [];
      let loadedPolicy: PolicySettings = defaultPolicySettings;
      try { if (bundlesJson) loadedBundles = JSON.parse(bundlesJson); } catch { /* corrupted data, use default */ }
      try { if (policyJson) loadedPolicy = JSON.parse(policyJson); } catch { /* corrupted data, use default */ }

      setWallets(loadedWallets);
      setBundles(loadedBundles);
      setPolicySettings(loadedPolicy);
      setHasWallet(loadedWallets.length > 0);

      if (networkId) {
        setSelectedNetworkState(networkId as NetworkId);
      }

      const activeRecord = await getActiveWallet();
      if (activeRecord && loadedWallets.length > 0) {
        setActiveWalletState(walletRecordToWallet(activeRecord));
      } else if (loadedWallets.length > 0) {
        setActiveWalletState(loadedWallets[0]);
      }
    } catch (error) {
      console.error("Failed to load wallet data:", error);
    } finally {
      setIsInitialized(true);
    }
  };

  const setActiveWallet = async (wallet: Wallet | null) => {
    // Clear in-memory portfolio cache before switching
    resetPortfolioCache();
    // Set active wallet in state immediately for UI
    setActiveWalletState(wallet);
    if (wallet) {
      await setActiveWalletById(wallet.id);
    }
    // Bump nonce to force portfolio refresh
    setPortfolioRefreshNonce(n => n + 1);
    if (__DEV__) {
      console.log("[WalletContext] Active wallet changed, portfolio nonce bumped");
    }
  };

  const setSelectedNetwork = async (networkId: NetworkId) => {
    setSelectedNetworkState(networkId);
    await AsyncStorage.setItem(STORAGE_KEYS.SELECTED_NETWORK, networkId);
  };

  const addWallet = async (wallet: Wallet) => {
    // Use functional update to avoid stale closure issues
    setWallets(prev => [...prev, wallet]);
    setHasWallet(true);
    // Clear in-memory portfolio cache before switching
    resetPortfolioCache();
    // Set active wallet immediately for UI responsiveness
    setActiveWalletState(wallet);
    // Persist active wallet ID
    await setActiveWalletById(wallet.id);
    // Bump nonce to force portfolio refresh
    setPortfolioRefreshNonce(n => n + 1);
    if (__DEV__) {
      console.log("[WalletContext] Wallet added and set as active:", wallet.name);
    }
  };

  const removeWallet = async (walletId: string) => {
    const newWallets = wallets.filter((w) => w.id !== walletId);
    setWallets(newWallets);
    if (activeWallet?.id === walletId) {
      setActiveWallet(newWallets[0] || null);
    }
    if (newWallets.length === 0) {
      setHasWallet(false);
    }
  };

  const renameWallet = async (walletId: string, newName: string) => {
    await renameWalletEngine(walletId, newName);
    const updatedWallets = wallets.map((w) =>
      w.id === walletId ? { ...w, name: newName.trim() } : w
    );
    setWallets(updatedWallets);
    if (activeWallet?.id === walletId) {
      setActiveWalletState({ ...activeWallet, name: newName.trim() });
    }
  };

  const addBundle = async (bundle: Bundle) => {
    const newBundles = [...bundles, bundle];
    setBundles(newBundles);
    await AsyncStorage.setItem(STORAGE_KEYS.BUNDLES, JSON.stringify(newBundles));
  };

  const removeBundle = async (bundleId: string) => {
    const newBundles = bundles.filter((b) => b.id !== bundleId);
    setBundles(newBundles);
    await AsyncStorage.setItem(STORAGE_KEYS.BUNDLES, JSON.stringify(newBundles));
  };

  const updatePolicySettings = async (settings: Partial<PolicySettings>) => {
    const newSettings = { ...policySettings, ...settings };
    setPolicySettings(newSettings);
    await AsyncStorage.setItem(STORAGE_KEYS.POLICY_SETTINGS, JSON.stringify(newSettings));
  };

  const unlock = () => {
    setIsUnlocked(true);
  };

  const lock = () => {
    setIsUnlocked(false);
  };

  const logout = async () => {
    await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
    setWallets([]);
    setBundles([]);
    setActiveWalletState(null);
    setPolicySettings(defaultPolicySettings);
    setHasWallet(false);
    setIsUnlocked(false);
  };

  const resetWalletState = () => {
    setWallets([]);
    setActiveWalletState(null);
    setHasWallet(false);
    setIsUnlocked(false);
  };

  return (
    <WalletContext.Provider
      value={{
        isInitialized,
        isUnlocked,
        hasWallet,
        activeWallet,
        wallets,
        bundles,
        selectedNetwork,
        policySettings,
        balances,
        transactions,
        approvals,
        portfolioRefreshNonce,
        setActiveWallet,
        setSelectedNetwork,
        addWallet,
        removeWallet,
        renameWallet,
        addBundle,
        removeBundle,
        updatePolicySettings,
        unlock,
        lock,
        logout,
        refreshWallets,
        resetWalletState,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
