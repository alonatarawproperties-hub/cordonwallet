import { formatEther, hexToString, isHex } from "viem";
import { getChainById } from "../blockchain/chains";
import { detectApproveIntent } from "../approvals/detect";
import type { DetectedApproval } from "../approvals/types";

export interface PersonalSignRequest {
  method: "personal_sign";
  message: string;
  messageHex: string;
  address: `0x${string}`;
  displayMessage: string;
}

export interface SendTransactionRequest {
  method: "eth_sendTransaction";
  tx: {
    from: `0x${string}`;
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: string;
    gas?: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    nonce?: string;
  };
  chainId: number;
  valueFormatted: string;
  approval?: DetectedApproval;
  isApproval: boolean;
  isNativeTransfer: boolean;
}

export interface SolanaSignMessageRequest {
  method: "solana_signMessage";
  message: string;
  pubkey: string;
  displayMessage: string;
}

export interface SolanaSignTransactionRequest {
  method: "solana_signTransaction";
  transaction: string;
  pubkey: string;
}

export interface SolanaSignAllTransactionsRequest {
  method: "solana_signAllTransactions";
  transactions: string[];
  pubkey: string;
}

export interface SignTypedDataRequest {
  method: "eth_signTypedData" | "eth_signTypedData_v4";
  address: `0x${string}`;
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  displaySummary: string;
}

export type SolanaRequest =
  | SolanaSignMessageRequest
  | SolanaSignTransactionRequest
  | SolanaSignAllTransactionsRequest;

export type ParsedRequest = PersonalSignRequest | SendTransactionRequest | SignTypedDataRequest | SolanaRequest;

export function parsePersonalSign(params: unknown[]): PersonalSignRequest {
  let message: string;
  let address: `0x${string}`;

  if (isHex(params[0] as string) && !isHex(params[1] as string)) {
    message = params[0] as string;
    address = params[1] as `0x${string}`;
  } else {
    address = params[0] as `0x${string}`;
    message = params[1] as string;
  }

  let displayMessage: string;
  if (isHex(message)) {
    try {
      displayMessage = hexToString(message as `0x${string}`);
    } catch {
      displayMessage = message;
    }
  } else {
    displayMessage = message;
  }

  return {
    method: "personal_sign",
    message,
    messageHex: isHex(message) ? message : `0x${Buffer.from(message).toString("hex")}`,
    address,
    displayMessage,
  };
}

export function parseSendTransaction(
  params: unknown[],
  chainId: number
): SendTransactionRequest {
  const txParams = params[0] as Record<string, unknown>;

  const tx: SendTransactionRequest["tx"] = {
    from: txParams.from as `0x${string}`,
    to: txParams.to as `0x${string}`,
    data: txParams.data as `0x${string}` | undefined,
    value: txParams.value as string | undefined,
    gas: (txParams.gas || txParams.gasLimit) as string | undefined,
    gasPrice: txParams.gasPrice as string | undefined,
    maxFeePerGas: txParams.maxFeePerGas as string | undefined,
    maxPriorityFeePerGas: txParams.maxPriorityFeePerGas as string | undefined,
    nonce: txParams.nonce as string | undefined,
  };

  let valueFormatted = "0";
  if (tx.value) {
    try {
      const valueBigInt = BigInt(tx.value);
      valueFormatted = formatEther(valueBigInt);
    } catch {
      valueFormatted = "0";
    }
  }

  let approval: DetectedApproval | undefined;
  let isApproval = false;

  if (tx.data && tx.to) {
    const detected = detectApproveIntent(tx.data, tx.to);
    if (detected) {
      approval = detected;
      isApproval = true;
    }
  }

  const isNativeTransfer = !tx.data || tx.data === "0x";

  return {
    method: "eth_sendTransaction",
    tx,
    chainId,
    valueFormatted,
    approval,
    isApproval,
    isNativeTransfer,
  };
}

export function parseSolanaSignMessage(params: unknown[]): SolanaSignMessageRequest {
  let paramObj: Record<string, unknown>;
  if (Array.isArray(params)) {
    paramObj = params[0] as Record<string, unknown> || {};
  } else {
    paramObj = params as unknown as Record<string, unknown>;
  }
  
  const message = (paramObj.message as string) || "";
  const pubkey = (paramObj.pubkey as string) || "";
  
  let displayMessage: string;
  try {
    const bs58 = require("bs58");
    const bytes = bs58.decode(message);
    displayMessage = new TextDecoder().decode(bytes);
  } catch {
    displayMessage = message;
  }

  return {
    method: "solana_signMessage",
    message,
    pubkey,
    displayMessage,
  };
}

export function parseSolanaSignTransaction(params: unknown[]): SolanaSignTransactionRequest {
  let paramObj: Record<string, unknown>;
  if (Array.isArray(params)) {
    paramObj = params[0] as Record<string, unknown> || {};
  } else {
    paramObj = params as unknown as Record<string, unknown>;
  }
  
  const transaction = (paramObj.transaction as string) || "";
  const pubkey = (paramObj.pubkey as string) || "";

  return {
    method: "solana_signTransaction",
    transaction,
    pubkey,
  };
}

export function parseSolanaSignAllTransactions(params: unknown[]): SolanaSignAllTransactionsRequest {
  // WalletConnect Solana params can be either:
  // 1. An object directly: { transactions, pubkey }
  // 2. An array with object: [{ transactions, pubkey }]
  let paramObj: Record<string, unknown>;
  if (Array.isArray(params)) {
    paramObj = params[0] as Record<string, unknown> || {};
  } else {
    paramObj = params as unknown as Record<string, unknown>;
  }
  
  const transactions = (paramObj.transactions as string[]) || [];
  const pubkey = (paramObj.pubkey as string) || "";

  return {
    method: "solana_signAllTransactions",
    transactions,
    pubkey,
  };
}

export function parseSignTypedData(
  method: "eth_signTypedData" | "eth_signTypedData_v4",
  params: unknown[]
): SignTypedDataRequest {
  // eth_signTypedData_v4 params are [address, jsonString]
  const address = params[0] as `0x${string}`;
  let typedData: SignTypedDataRequest["typedData"];

  const raw = params[1];
  if (typeof raw === "string") {
    typedData = JSON.parse(raw);
  } else {
    typedData = raw as SignTypedDataRequest["typedData"];
  }

  const domainName = (typedData.domain as Record<string, unknown>)?.name as string | undefined;
  const displaySummary = domainName
    ? `Sign typed data from ${domainName}`
    : "Sign structured data";

  return {
    method,
    address,
    typedData,
    displaySummary,
  };
}

export function parseSessionRequest(
  method: string,
  params: unknown[],
  chainId: number,
  isSolana: boolean = false
): ParsedRequest | null {
  switch (method) {
    case "personal_sign":
      return parsePersonalSign(params);

    case "eth_sendTransaction":
      return parseSendTransaction(params, chainId);

    case "eth_sign":
      return parsePersonalSign(params);

    case "eth_signTypedData":
      return parseSignTypedData("eth_signTypedData", params);

    case "eth_signTypedData_v4":
      return parseSignTypedData("eth_signTypedData_v4", params);

    case "solana_signMessage":
      return parseSolanaSignMessage(params);

    case "solana_signTransaction":
      return parseSolanaSignTransaction(params);

    case "solana_signAllTransactions":
      return parseSolanaSignAllTransactions(params);

    default:
      return null;
  }
}

export function modifyTransactionData(
  originalData: `0x${string}`,
  newAmount: bigint
): `0x${string}` {
  const methodId = originalData.slice(0, 10);
  const spenderPadded = originalData.slice(10, 74);
  const newAmountHex = newAmount.toString(16).padStart(64, "0");

  return `${methodId}${spenderPadded}${newAmountHex}` as `0x${string}`;
}

export function getChainName(chainId: number): string {
  const chain = getChainById(chainId);
  return chain?.name || `Chain ${chainId}`;
}
