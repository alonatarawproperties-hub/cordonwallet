import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Wallet, Bundle, NetworkId, PolicySettings, Transaction, Approval, TokenBalance } from "./types";

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
  setActiveWallet: (wallet: Wallet | null) => void;
  setSelectedNetwork: (networkId: NetworkId) => void;
  addWallet: (wallet: Wallet) => Promise<void>;
  removeWallet: (walletId: string) => Promise<void>;
  addBundle: (bundle: Bundle) => Promise<void>;
  removeBundle: (bundleId: string) => Promise<void>;
  updatePolicySettings: (settings: Partial<PolicySettings>) => Promise<void>;
  unlock: () => void;
  lock: () => void;
  logout: () => Promise<void>;
}

const defaultPolicySettings: PolicySettings = {
  blockUnlimitedApprovals: true,
  maxSpendPerTransaction: "1000",
  dailySpendLimit: "5000",
  allowlistedAddresses: [],
  denylistedAddresses: [],
};

const STORAGE_KEYS = {
  WALLETS: "@shieldwallet/wallets",
  BUNDLES: "@shieldwallet/bundles",
  ACTIVE_WALLET_ID: "@shieldwallet/active_wallet_id",
  POLICY_SETTINGS: "@shieldwallet/policy_settings",
  SELECTED_NETWORK: "@shieldwallet/selected_network",
  HAS_SETUP: "@shieldwallet/has_setup",
};

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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [walletsJson, bundlesJson, activeWalletId, policyJson, networkId, hasSetup] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.WALLETS),
        AsyncStorage.getItem(STORAGE_KEYS.BUNDLES),
        AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_WALLET_ID),
        AsyncStorage.getItem(STORAGE_KEYS.POLICY_SETTINGS),
        AsyncStorage.getItem(STORAGE_KEYS.SELECTED_NETWORK),
        AsyncStorage.getItem(STORAGE_KEYS.HAS_SETUP),
      ]);

      const loadedWallets: Wallet[] = walletsJson ? JSON.parse(walletsJson) : [];
      const loadedBundles: Bundle[] = bundlesJson ? JSON.parse(bundlesJson) : [];
      const loadedPolicy: PolicySettings = policyJson ? JSON.parse(policyJson) : defaultPolicySettings;

      setWallets(loadedWallets);
      setBundles(loadedBundles);
      setPolicySettings(loadedPolicy);
      setHasWallet(loadedWallets.length > 0);

      if (networkId) {
        setSelectedNetworkState(networkId as NetworkId);
      }

      if (activeWalletId && loadedWallets.length > 0) {
        const wallet = loadedWallets.find((w) => w.id === activeWalletId);
        if (wallet) {
          setActiveWalletState(wallet);
        } else {
          setActiveWalletState(loadedWallets[0]);
        }
      } else if (loadedWallets.length > 0) {
        setActiveWalletState(loadedWallets[0]);
      }

      if (hasSetup === "true" && loadedWallets.length > 0) {
        setHasWallet(true);
      }
    } catch (error) {
      console.error("Failed to load wallet data:", error);
    } finally {
      setIsInitialized(true);
    }
  };

  const setActiveWallet = async (wallet: Wallet | null) => {
    setActiveWalletState(wallet);
    if (wallet) {
      await AsyncStorage.setItem(STORAGE_KEYS.ACTIVE_WALLET_ID, wallet.id);
    }
  };

  const setSelectedNetwork = async (networkId: NetworkId) => {
    setSelectedNetworkState(networkId);
    await AsyncStorage.setItem(STORAGE_KEYS.SELECTED_NETWORK, networkId);
  };

  const addWallet = async (wallet: Wallet) => {
    const newWallets = [...wallets, wallet];
    setWallets(newWallets);
    setHasWallet(true);
    await AsyncStorage.setItem(STORAGE_KEYS.WALLETS, JSON.stringify(newWallets));
    await AsyncStorage.setItem(STORAGE_KEYS.HAS_SETUP, "true");
    if (!activeWallet) {
      setActiveWallet(wallet);
    }
  };

  const removeWallet = async (walletId: string) => {
    const newWallets = wallets.filter((w) => w.id !== walletId);
    setWallets(newWallets);
    await AsyncStorage.setItem(STORAGE_KEYS.WALLETS, JSON.stringify(newWallets));
    if (activeWallet?.id === walletId) {
      setActiveWallet(newWallets[0] || null);
    }
    if (newWallets.length === 0) {
      setHasWallet(false);
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
        setActiveWallet,
        setSelectedNetwork,
        addWallet,
        removeWallet,
        addBundle,
        removeBundle,
        updatePolicySettings,
        unlock,
        lock,
        logout,
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
