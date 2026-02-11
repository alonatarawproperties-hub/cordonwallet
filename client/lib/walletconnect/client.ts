import { Core } from "@walletconnect/core";
import {
  Web3Wallet,
  Web3WalletTypes,
  IWeb3Wallet,
} from "@walletconnect/web3wallet";
import { getSdkError, buildApprovedNamespaces } from "@walletconnect/utils";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FEATURES } from "@/config/features";

const WC_PROJECT_ID = process.env.EXPO_PUBLIC_WC_PROJECT_ID || "";

const STORAGE_KEY_SESSIONS = "@cordon/wc_sessions";

export const SUPPORTED_EVM_CHAINS = {
  ethereum: { chainId: 1, namespace: "eip155:1" },
  polygon: { chainId: 137, namespace: "eip155:137" },
  bnb: { chainId: 56, namespace: "eip155:56" },
};

export const SOLANA_MAINNET_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export const SUPPORTED_CHAINS = {
  ...SUPPORTED_EVM_CHAINS,
  solana: { chainId: 0, namespace: SOLANA_MAINNET_CHAIN },
};

export const SUPPORTED_EVM_METHODS = [
  "eth_sendTransaction",
  "personal_sign",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v1",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
];

export const SUPPORTED_SOLANA_METHODS = [
  "solana_signMessage",
  "solana_signTransaction",
  "solana_signAndSendTransaction",
  "solana_signAllTransactions",
];

export const SUPPORTED_METHODS = [
  ...SUPPORTED_EVM_METHODS,
  ...SUPPORTED_SOLANA_METHODS,
];

export const SUPPORTED_EVENTS = ["chainChanged", "accountsChanged"];

let web3wallet: IWeb3Wallet | null = null;
let core: InstanceType<typeof Core> | null = null;
let initPromise: Promise<IWeb3Wallet> | null = null;

export interface WCSession {
  topic: string;
  peerMeta: {
    name: string;
    description: string;
    url: string;
    icons: string[];
  };
  chains: string[];
  expiry: number;
}

export interface SessionProposal {
  id: number;
  params: Web3WalletTypes.SessionProposal["params"];
}

export interface SessionRequest {
  id: number;
  topic: string;
  params: {
    request: {
      method: string;
      params: unknown;
    };
    chainId: string;
  };
}

function decodeUriSafely(value: string): string {
  let decoded = value;

  for (let i = 0; i < 2; i += 1) {
    try {
      const nextDecoded = decodeURIComponent(decoded);
      if (nextDecoded === decoded) break;
      decoded = nextDecoded;
    } catch {
      break;
    }
  }

  return decoded;
}

export function normalizeWalletConnectUri(input: string): string | null {
  if (!input) return null;

  let uri = decodeUriSafely(input.trim().replace(/["'<>]/g, ""));
  const lower = uri.toLowerCase();

  try {
    if (
      lower.startsWith("http://") ||
      lower.startsWith("https://") ||
      lower.startsWith("walletconnect://") ||
      lower.startsWith("wc://")
    ) {
      const parsed = new URL(uri);
      const embedded =
        parsed.searchParams.get("uri") || parsed.searchParams.get("wc");

      if (embedded) {
        uri = decodeUriSafely(embedded);
      } else if (parsed.protocol === "wc:") {
        uri = uri.replace(/^wc:\/\//i, "wc:");
      }
    }
  } catch {
    // Ignore malformed URL payloads and continue parsing raw input.
  }

  const match = uri.match(/wc:[^\s]+/i);
  if (!match?.[0]) return null;

  const normalized = decodeUriSafely(match[0]);
  return normalized.startsWith("wc:")
    ? normalized
    : `wc:${normalized.slice(normalized.indexOf(":") + 1)}`;
}

export async function initWalletConnect(): Promise<IWeb3Wallet> {
  if (web3wallet) return web3wallet;
  if (initPromise) return initPromise;

  if (!WC_PROJECT_ID) {
    throw new Error(
      "WalletConnect Project ID not configured. Set EXPO_PUBLIC_WC_PROJECT_ID in environment.",
    );
  }

  initPromise = (async () => {
    core = new Core({
      projectId: WC_PROJECT_ID,
      relayUrl: "wss://relay.walletconnect.com",
    });

    const wallet = await Web3Wallet.init({
      core: core as any,
      metadata: {
        name: "Cordon",
        description: "Non-custodial EVM + Solana wallet with Wallet Firewall",
        url: "https://cordon.wallet",
        icons: ["https://cordon.wallet/icon.png"],
      },
    });

    web3wallet = wallet;
    return wallet;
  })();

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

export function getWeb3Wallet(): IWeb3Wallet | null {
  return web3wallet;
}

export function getCore(): InstanceType<typeof Core> | null {
  return core;
}

export async function pairWithUri(uriInput: string): Promise<void> {
  const uri = normalizeWalletConnectUri(uriInput);

  if (!uri) {
    throw new Error("Invalid WalletConnect URI");
  }

  const wallet = await initWalletConnect();

  await Promise.race([
    wallet.pair({ uri }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("WalletConnect pairing timed out. Please try again.")), 20000);
    }),
  ]);
}

export interface MultiChainAddresses {
  evm: `0x${string}`;
  solana?: string;
}

export function buildNamespaces(
  proposal: SessionProposal,
  addresses: MultiChainAddresses,
): Record<
  string,
  { accounts: string[]; methods: string[]; events: string[]; chains?: string[] }
> {
  const hasValidEvmAddress = !!addresses.evm && addresses.evm.length > 2;
  const hasValidSolanaAddress =
    !!addresses.solana && addresses.solana.length > 0;

  const evmChainIds = Object.values(SUPPORTED_EVM_CHAINS).map(
    (c) => c.namespace,
  );

  const evmAccounts: string[] = [];
  if (hasValidEvmAddress) {
    for (const chainNamespace of evmChainIds) {
      evmAccounts.push(`${chainNamespace}:${addresses.evm}`);
    }
  }

  const requiredNamespaces = proposal.params.requiredNamespaces || {};
  const optionalNamespaces = proposal.params.optionalNamespaces || {};

  const needsSolana =
    "solana" in requiredNamespaces ||
    "solana" in optionalNamespaces ||
    Object.values(requiredNamespaces).some((ns) =>
      ns.chains?.some((c) => c.startsWith("solana:")),
    ) ||
    Object.values(optionalNamespaces).some((ns) =>
      ns.chains?.some((c) => c.startsWith("solana:")),
    );

  const needsEvm =
    "eip155" in requiredNamespaces ||
    "eip155" in optionalNamespaces ||
    Object.values(requiredNamespaces).some((ns) =>
      ns.chains?.some((c) => c.startsWith("eip155:")),
    ) ||
    Object.values(optionalNamespaces).some((ns) =>
      ns.chains?.some((c) => c.startsWith("eip155:")),
    ) ||
    Object.keys(requiredNamespaces).length === 0;

  const supportedNamespaces: Record<
    string,
    {
      chains: string[];
      methods: string[];
      events: string[];
      accounts: string[];
    }
  > = {};

  if (needsEvm && hasValidEvmAddress) {
    supportedNamespaces.eip155 = {
      chains: evmChainIds,
      methods: SUPPORTED_EVM_METHODS,
      events: SUPPORTED_EVENTS,
      accounts: evmAccounts,
    };
  }

  if (needsSolana && hasValidSolanaAddress) {
    supportedNamespaces.solana = {
      chains: [SOLANA_MAINNET_CHAIN],
      methods: SUPPORTED_SOLANA_METHODS,
      events: SUPPORTED_EVENTS,
      accounts: [`${SOLANA_MAINNET_CHAIN}:${addresses.solana}`],
    };
  }

  try {
    const approvedNamespaces = buildApprovedNamespaces({
      proposal: proposal.params,
      supportedNamespaces,
    });

    if (approvedNamespaces && Object.keys(approvedNamespaces).length > 0) {
      return approvedNamespaces;
    }
  } catch (err) {
    console.warn(
      "[WalletConnect] buildApprovedNamespaces failed, using fallback:",
      err,
    );
  }

  const fallback: Record<
    string,
    {
      accounts: string[];
      methods: string[];
      events: string[];
      chains: string[];
    }
  > = {};

  if (needsEvm && hasValidEvmAddress) {
    fallback.eip155 = {
      accounts: evmAccounts,
      methods: SUPPORTED_EVM_METHODS,
      events: SUPPORTED_EVENTS,
      chains: evmChainIds,
    };
  }

  if (needsSolana && hasValidSolanaAddress) {
    fallback.solana = {
      accounts: [`${SOLANA_MAINNET_CHAIN}:${addresses.solana}`],
      methods: SUPPORTED_SOLANA_METHODS,
      events: SUPPORTED_EVENTS,
      chains: [SOLANA_MAINNET_CHAIN],
    };
  }

  return fallback;
}

export async function approveSession(
  proposal: SessionProposal,
  addresses: MultiChainAddresses,
): Promise<WCSession> {
  const wallet = await initWalletConnect();

  const hasValidEvmAddress = !!addresses.evm && addresses.evm.length > 2;
  const hasValidSolanaAddress =
    !!addresses.solana && addresses.solana.length > 0;

  const requiredNamespaces = proposal.params.requiredNamespaces || {};
  const requiresSolana =
    "solana" in requiredNamespaces ||
    Object.values(requiredNamespaces).some((ns) =>
      ns.chains?.some((c) => c?.startsWith("solana:")),
    );

  const requiresEvm =
    "eip155" in requiredNamespaces ||
    Object.values(requiredNamespaces).some((ns) =>
      ns.chains?.some((c) => c?.startsWith("eip155:")),
    );

  if (requiresSolana && !hasValidSolanaAddress) {
    throw new Error(
      "This dApp requires Solana but your wallet does not have a Solana address configured",
    );
  }

  if (requiresEvm && !hasValidEvmAddress) {
    throw new Error(
      "This dApp requires EVM chains but your wallet does not have an EVM address. Try importing or creating a multi-chain wallet.",
    );
  }

  const namespaces = buildNamespaces(proposal, addresses);

  console.log(
    "[WalletConnect] Approving session with namespaces:",
    JSON.stringify(namespaces, null, 2),
  );

  if (!namespaces || Object.keys(namespaces).length === 0) {
    throw new Error("Failed to build namespaces for session approval");
  }

  const session = await wallet.approveSession({
    id: proposal.id,
    namespaces,
  });

  return {
    topic: session.topic,
    peerMeta: {
      name: session.peer.metadata.name,
      description: session.peer.metadata.description,
      url: session.peer.metadata.url,
      icons: session.peer.metadata.icons,
    },
    chains: Object.keys(session.namespaces).flatMap(
      (ns) => session.namespaces[ns].chains || [],
    ),
    expiry: session.expiry,
  };
}

export async function rejectSession(proposalId: number): Promise<void> {
  const wallet = await initWalletConnect();
  await wallet.rejectSession({
    id: proposalId,
    reason: getSdkError("USER_REJECTED"),
  });
}

export async function disconnectSession(topic: string): Promise<void> {
  const wallet = await initWalletConnect();
  await wallet.disconnectSession({
    topic,
    reason: getSdkError("USER_DISCONNECTED"),
  });
}

export function getActiveSessions(): WCSession[] {
  if (!web3wallet) return [];

  const sessions = web3wallet.getActiveSessions();
  return Object.values(sessions).map((session) => ({
    topic: session.topic,
    peerMeta: {
      name: session.peer.metadata.name,
      description: session.peer.metadata.description,
      url: session.peer.metadata.url,
      icons: session.peer.metadata.icons,
    },
    chains: Object.keys(session.namespaces).flatMap(
      (ns) => session.namespaces[ns].chains || [],
    ),
    expiry: session.expiry,
  }));
}

export async function respondToRequest(
  topic: string,
  requestId: number,
  result: unknown,
): Promise<void> {
  const wallet = await initWalletConnect();
  await wallet.respondSessionRequest({
    topic,
    response: {
      id: requestId,
      jsonrpc: "2.0",
      result,
    },
  });
}

export async function rejectRequest(
  topic: string,
  requestId: number,
  message?: string,
): Promise<void> {
  const wallet = await initWalletConnect();
  await wallet.respondSessionRequest({
    topic,
    response: {
      id: requestId,
      jsonrpc: "2.0",
      error: {
        code: 4001,
        message: message || "User rejected the request",
      },
    },
  });
}

export function parseChainId(wcChainId: string): number {
  const parts = wcChainId.split(":");
  if (parts.length === 2 && parts[0] === "eip155") {
    return parseInt(parts[1], 10);
  }
  return 1;
}

export function isSolanaChain(wcChainId: string): boolean {
  return wcChainId.startsWith("solana:");
}

export function proposalRequiresEvm(proposal: SessionProposal): boolean {
  const requiredNamespaces = proposal.params.requiredNamespaces || {};
  const optionalNamespaces = proposal.params.optionalNamespaces || {};

  const needsEvm =
    "eip155" in requiredNamespaces ||
    "eip155" in optionalNamespaces ||
    Object.values(requiredNamespaces).some((ns) =>
      ns.chains?.some((c) => c.startsWith("eip155:")),
    ) ||
    Object.values(optionalNamespaces).some((ns) =>
      ns.chains?.some((c) => c.startsWith("eip155:")),
    ) ||
    Object.keys(requiredNamespaces).length === 0;

  return needsEvm;
}

export function proposalRequiresSolana(proposal: SessionProposal): boolean {
  const requiredNamespaces = proposal.params.requiredNamespaces || {};
  const optionalNamespaces = proposal.params.optionalNamespaces || {};

  return (
    "solana" in requiredNamespaces ||
    "solana" in optionalNamespaces ||
    Object.values(requiredNamespaces).some((ns) =>
      ns.chains?.some((c) => c.startsWith("solana:")),
    ) ||
    Object.values(optionalNamespaces).some((ns) =>
      ns.chains?.some((c) => c.startsWith("solana:")),
    )
  );
}

export function shouldRejectProposalForDisabledChains(
  proposal: SessionProposal,
): { reject: boolean; reason: string } | null {
  const needsEvm = proposalRequiresEvm(proposal);
  const needsSolana = proposalRequiresSolana(proposal);

  if (!FEATURES.EVM_ENABLED && needsEvm && !needsSolana) {
    return { reject: true, reason: "EVM chains coming soon" };
  }

  if (!FEATURES.SOLANA_ENABLED && needsSolana && !needsEvm) {
    return { reject: true, reason: "Solana coming soon" };
  }

  return null;
}

export function formatChainNamespace(chainId: number): string {
  return `eip155:${chainId}`;
}
