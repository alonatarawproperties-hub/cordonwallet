import { Core } from "@walletconnect/core";
import { Web3Wallet, Web3WalletTypes, IWeb3Wallet } from "@walletconnect/web3wallet";
import { getSdkError, buildApprovedNamespaces } from "@walletconnect/utils";
import AsyncStorage from "@react-native-async-storage/async-storage";

const WC_PROJECT_ID = process.env.EXPO_PUBLIC_WC_PROJECT_ID || "";

const STORAGE_KEY_SESSIONS = "@cordon/wc_sessions";

export const SUPPORTED_CHAINS = {
  ethereum: { chainId: 1, namespace: "eip155:1" },
  polygon: { chainId: 137, namespace: "eip155:137" },
  bnb: { chainId: 56, namespace: "eip155:56" },
};

export const SUPPORTED_METHODS = [
  "eth_sendTransaction",
  "personal_sign",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
];

export const SUPPORTED_EVENTS = ["chainChanged", "accountsChanged"];

let web3wallet: IWeb3Wallet | null = null;
let core: InstanceType<typeof Core> | null = null;

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
      params: unknown[];
    };
    chainId: string;
  };
}

export async function initWalletConnect(): Promise<IWeb3Wallet> {
  if (web3wallet) {
    return web3wallet;
  }

  if (!WC_PROJECT_ID) {
    throw new Error("WalletConnect Project ID not configured. Set EXPO_PUBLIC_WC_PROJECT_ID in environment.");
  }

  core = new Core({
    projectId: WC_PROJECT_ID,
    relayUrl: "wss://relay.walletconnect.com",
  });

  web3wallet = await Web3Wallet.init({
    core: core as any,
    metadata: {
      name: "Cordon",
      description: "Non-custodial EVM + Solana wallet with Wallet Firewall",
      url: "https://cordon.wallet",
      icons: ["https://cordon.wallet/icon.png"],
    },
  });

  return web3wallet;
}

export function getWeb3Wallet(): IWeb3Wallet | null {
  return web3wallet;
}

export async function pairWithUri(uri: string): Promise<void> {
  const wallet = await initWalletConnect();
  await wallet.pair({ uri });
}

export function buildNamespaces(
  proposal: SessionProposal,
  evmAddress: `0x${string}`
): Record<string, { accounts: string[]; methods: string[]; events: string[]; chains?: string[] }> {
  const supportedChainIds = Object.values(SUPPORTED_CHAINS).map((c) => c.namespace);

  const accounts: string[] = [];
  for (const chainNamespace of supportedChainIds) {
    accounts.push(`${chainNamespace}:${evmAddress}`);
  }

  try {
    const approvedNamespaces = buildApprovedNamespaces({
      proposal: proposal.params,
      supportedNamespaces: {
        eip155: {
          chains: supportedChainIds,
          methods: SUPPORTED_METHODS,
          events: SUPPORTED_EVENTS,
          accounts,
        },
      },
    });

    if (approvedNamespaces && Object.keys(approvedNamespaces).length > 0) {
      return approvedNamespaces;
    }
  } catch (err) {
    console.warn("[WalletConnect] buildApprovedNamespaces failed, using fallback:", err);
  }

  return {
    eip155: {
      accounts,
      methods: SUPPORTED_METHODS,
      events: SUPPORTED_EVENTS,
      chains: supportedChainIds,
    },
  };
}

export async function approveSession(
  proposal: SessionProposal,
  evmAddress: `0x${string}`
): Promise<WCSession> {
  const wallet = await initWalletConnect();

  const namespaces = buildNamespaces(proposal, evmAddress);
  
  console.log("[WalletConnect] Approving session with namespaces:", JSON.stringify(namespaces, null, 2));

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
      (ns) => session.namespaces[ns].chains || []
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
      (ns) => session.namespaces[ns].chains || []
    ),
    expiry: session.expiry,
  }));
}

export async function respondToRequest(
  topic: string,
  requestId: number,
  result: unknown
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
  message?: string
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

export function formatChainNamespace(chainId: number): string {
  return `eip155:${chainId}`;
}
