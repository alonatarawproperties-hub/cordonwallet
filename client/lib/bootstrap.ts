import AsyncStorage from "@react-native-async-storage/async-storage";
import { Asset } from "expo-asset";
import * as Font from "expo-font";
import { hasVault, isUnlocked } from "./wallet-engine";
import { initWalletConnect, getActiveSessions } from "./walletconnect/client";
import { supportedChains, getDefaultChain } from "./blockchain/chains";
import { createPublicClient, http } from "viem";
import { Connection } from "@solana/web3.js";

const STORAGE_KEYS = {
  LAST_CHAIN_ID: "@cordon/last_chain_id",
  THEME_MODE: "@cordon/theme_mode",
  FIREWALL_SETTINGS: "@cordon/firewall_settings",
  LAST_WALLET_ID: "@cordon/last_wallet_id",
};

const STEP_TIMEOUTS: Record<string, number> = {
  preloadAssets: 2000,
  initSettings: 1000,
  initChainRegistry: 500,
  initWalletConnect: 2500,
  checkVaultExists: 1000,
  pingRPC: 1200,
};

const GLOBAL_TIMEOUT = 6000;

export type InitialRoute = "Welcome" | "Unlock" | "Main";

export interface DegradedInfo {
  chainKey: string;
  reason: string;
}

export interface BootResult {
  hasVault: boolean;
  initialRoute: InitialRoute;
  restoredSessionsCount: number;
  degraded: DegradedInfo[];
  timings: Record<string, number>;
}

export interface UserSettings {
  lastChainId: number | null;
  themeMode: "light" | "dark" | "system";
  firewallDefaults: {
    blockUnlimitedApprovals: boolean;
    allowlistedAddresses: string[];
    denylistedAddresses: string[];
  };
  lastWalletId: string | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function preloadAssets(
  onProgress: (step: string, pct: number) => void
): Promise<{ success: boolean; error?: string }> {
  const start = Date.now();
  onProgress("preloadAssets", 0);

  try {
    const assetModules = [
      require("../../assets/images/icon.png"),
    ];

    await Asset.loadAsync(assetModules);
    onProgress("preloadAssets", 100);
    return { success: true };
  } catch (error: any) {
    console.warn("[Bootstrap] Asset preload failed:", error.message);
    return { success: true };
  }
}

async function initSettings(
  onProgress: (step: string, pct: number) => void
): Promise<UserSettings> {
  onProgress("initSettings", 0);

  try {
    const [lastChainIdStr, themeMode, firewallStr, lastWalletId] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.LAST_CHAIN_ID),
      AsyncStorage.getItem(STORAGE_KEYS.THEME_MODE),
      AsyncStorage.getItem(STORAGE_KEYS.FIREWALL_SETTINGS),
      AsyncStorage.getItem(STORAGE_KEYS.LAST_WALLET_ID),
    ]);

    const settings: UserSettings = {
      lastChainId: lastChainIdStr ? parseInt(lastChainIdStr, 10) : null,
      themeMode: (themeMode as "light" | "dark" | "system") || "dark",
      firewallDefaults: firewallStr
        ? JSON.parse(firewallStr)
        : {
            blockUnlimitedApprovals: true,
            allowlistedAddresses: [],
            denylistedAddresses: [],
          },
      lastWalletId: lastWalletId || null,
    };

    onProgress("initSettings", 100);
    return settings;
  } catch (error) {
    console.warn("[Bootstrap] Settings load failed, using defaults");
    onProgress("initSettings", 100);
    return {
      lastChainId: null,
      themeMode: "dark",
      firewallDefaults: {
        blockUnlimitedApprovals: true,
        allowlistedAddresses: [],
        denylistedAddresses: [],
      },
      lastWalletId: null,
    };
  }
}

async function initChainRegistry(
  onProgress: (step: string, pct: number) => void
): Promise<{ chains: typeof supportedChains }> {
  onProgress("initChainRegistry", 0);
  onProgress("initChainRegistry", 100);
  return { chains: supportedChains };
}

async function initWalletConnectClient(
  onProgress: (step: string, pct: number) => void
): Promise<{ sessionsCount: number; error?: string }> {
  onProgress("initWalletConnect", 0);

  try {
    await initWalletConnect();
    onProgress("initWalletConnect", 50);

    const sessions = await getActiveSessions();
    const count = sessions.length;

    onProgress("initWalletConnect", 100);
    return { sessionsCount: count };
  } catch (error: any) {
    console.warn("[Bootstrap] WalletConnect init failed:", error.message);
    onProgress("initWalletConnect", 100);
    return { sessionsCount: 0, error: error.message };
  }
}

async function checkVaultStatus(
  onProgress: (step: string, pct: number) => void
): Promise<{ hasVault: boolean; isUnlocked: boolean }> {
  onProgress("checkVaultExists", 0);

  try {
    const vaultExists = await hasVault();
    const unlocked = isUnlocked();

    onProgress("checkVaultExists", 100);
    return { hasVault: vaultExists, isUnlocked: unlocked };
  } catch (error) {
    console.warn("[Bootstrap] Vault check failed");
    onProgress("checkVaultExists", 100);
    return { hasVault: false, isUnlocked: false };
  }
}

async function pingLastSelectedRPC(
  settings: UserSettings,
  onProgress: (step: string, pct: number) => void
): Promise<DegradedInfo[]> {
  onProgress("pingRPC", 0);
  const degraded: DegradedInfo[] = [];

  try {
    const chainId = settings.lastChainId || getDefaultChain().chainId;
    const chain = supportedChains.find((c) => c.chainId === chainId) || getDefaultChain();

    const client = createPublicClient({
      chain: chain.viemChain,
      transport: http(chain.rpcUrl),
    });

    const blockNumber = await withTimeout(
      client.getBlockNumber(),
      STEP_TIMEOUTS.pingRPC,
      null
    );

    if (blockNumber === null) {
      degraded.push({ chainKey: chain.name, reason: "RPC timeout" });
    }
  } catch (error: any) {
    degraded.push({ chainKey: "EVM", reason: error.message || "RPC error" });
  }

  try {
    const solanaRpcUrl = process.env.EXPO_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    const connection = new Connection(solanaRpcUrl, { commitment: "confirmed" });

    const slot = await withTimeout(
      connection.getSlot(),
      STEP_TIMEOUTS.pingRPC,
      null
    );

    if (slot === null) {
      degraded.push({ chainKey: "Solana", reason: "RPC timeout" });
    }
  } catch (error: any) {
    degraded.push({ chainKey: "Solana", reason: error.message || "RPC error" });
  }

  onProgress("pingRPC", 100);
  return degraded;
}

export async function bootstrapApp(
  onProgress?: (step: string, pct: number) => void
): Promise<BootResult> {
  const timings: Record<string, number> = {};
  const progress = onProgress || (() => {});
  let restoredSessionsCount = 0;
  let degraded: DegradedInfo[] = [];
  let vaultExists = false;
  let walletUnlocked = false;
  let settings: UserSettings;

  const stepStart = (name: string) => {
    timings[`${name}_start`] = Date.now();
  };

  const stepEnd = (name: string) => {
    const start = timings[`${name}_start`] || Date.now();
    timings[name] = Date.now() - start;
  };

  stepStart("preloadAssets");
  await withTimeout(preloadAssets(progress), STEP_TIMEOUTS.preloadAssets, { success: false });
  stepEnd("preloadAssets");

  stepStart("initSettings");
  settings = await withTimeout(
    initSettings(progress),
    STEP_TIMEOUTS.initSettings,
    {
      lastChainId: null,
      themeMode: "dark" as const,
      firewallDefaults: {
        blockUnlimitedApprovals: true,
        allowlistedAddresses: [],
        denylistedAddresses: [],
      },
      lastWalletId: null,
    }
  );
  stepEnd("initSettings");

  stepStart("initChainRegistry");
  await withTimeout(initChainRegistry(progress), STEP_TIMEOUTS.initChainRegistry, { chains: supportedChains });
  stepEnd("initChainRegistry");

  stepStart("initWalletConnect");
  const wcResult = await withTimeout(
    initWalletConnectClient(progress),
    STEP_TIMEOUTS.initWalletConnect,
    { sessionsCount: 0, error: "Timeout" }
  );
  restoredSessionsCount = wcResult.sessionsCount;
  stepEnd("initWalletConnect");

  stepStart("checkVaultExists");
  const vaultStatus = await withTimeout(
    checkVaultStatus(progress),
    STEP_TIMEOUTS.checkVaultExists,
    { hasVault: false, isUnlocked: false }
  );
  vaultExists = vaultStatus.hasVault;
  walletUnlocked = vaultStatus.isUnlocked;
  stepEnd("checkVaultExists");

  stepStart("pingRPC");
  degraded = await withTimeout(
    pingLastSelectedRPC(settings, progress),
    STEP_TIMEOUTS.pingRPC + 500,
    [{ chainKey: "Network", reason: "Check timeout" }]
  );
  stepEnd("pingRPC");

  let initialRoute: InitialRoute;
  if (!vaultExists) {
    initialRoute = "Welcome";
  } else if (walletUnlocked) {
    initialRoute = "Main";
  } else {
    initialRoute = "Unlock";
  }

  return {
    hasVault: vaultExists,
    initialRoute,
    restoredSessionsCount,
    degraded,
    timings,
  };
}

export function createBootstrapWithWatchdog(
  onProgress?: (step: string, pct: number) => void,
  onTimeout?: () => void
): { run: () => Promise<BootResult>; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const run = async (): Promise<BootResult> => {
    return new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        if (!cancelled && onTimeout) {
          onTimeout();
        }
      }, GLOBAL_TIMEOUT);

      bootstrapApp(onProgress)
        .then((result) => {
          if (timeoutId) clearTimeout(timeoutId);
          if (!cancelled) resolve(result);
        })
        .catch((error) => {
          if (timeoutId) clearTimeout(timeoutId);
          if (!cancelled) reject(error);
        });
    });
  };

  const cancel = () => {
    cancelled = true;
    if (timeoutId) clearTimeout(timeoutId);
  };

  return { run, cancel };
}
