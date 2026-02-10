import { getChainById } from "../blockchain/chains";

// Inline DetectedApproval type (approvals module removed for Phase I)
export interface DetectedApproval {
  tokenAddress: string;
  spender: string;
  amountRaw: string;
  isUnlimited: boolean;
}

// Inline viem utilities needed for EVM parsing (kept for WC compatibility)
function isHex(value: string): boolean {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

function hexToString(hex: string): string {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  let str = "";
  for (let i = 0; i < cleanHex.length; i += 2) {
    const code = parseInt(cleanHex.substring(i, i + 2), 16);
    if (code === 0) break;
    str += String.fromCharCode(code);
  }
  return str;
}

function formatEther(value: bigint): string {
  const str = value.toString();
  if (str.length <= 18) {
    return "0." + str.padStart(18, "0").replace(/0+$/, "") || "0";
  }
  const intPart = str.slice(0, str.length - 18);
  const decPart = str.slice(str.length - 18).replace(/0+$/, "");
  return decPart ? `${intPart}.${decPart}` : intPart;
}

// Inline approval detection (approvals module removed for Phase I)
function detectApproveIntent(data: string, to: string): DetectedApproval | null {
  if (!data || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  // ERC20 approve(address,uint256) = 0x095ea7b3
  if (selector !== "0x095ea7b3") return null;
  if (data.length < 138) return null;
  const spender = "0x" + data.slice(34, 74);
  const amountHex = data.slice(74, 138);
  const amountRaw = BigInt("0x" + amountHex).toString();
  const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  const isUnlimited = BigInt("0x" + amountHex) >= MAX_UINT256 / 2n;
  return { tokenAddress: to, spender, amountRaw, isUnlimited };
}

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

export interface SolanaSignAndSendTransactionRequest {
  method: "solana_signAndSendTransaction";
  transaction: string;
  pubkey: string;
}

export interface SignTypedDataRequest {
  method:
    | "eth_signTypedData"
    | "eth_signTypedData_v1"
    | "eth_signTypedData_v3"
    | "eth_signTypedData_v4";
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
  | SolanaSignAndSendTransactionRequest
  | SolanaSignAllTransactionsRequest;

export type ParsedRequest =
  | PersonalSignRequest
  | SendTransactionRequest
  | SignTypedDataRequest
  | SolanaRequest;

function normalizeParams(params: unknown): unknown[] {
  if (Array.isArray(params)) return params;
  if (params === null || typeof params === "undefined") return [];
  return [params];
}

export function parsePersonalSign(paramsInput: unknown): PersonalSignRequest {
  const params = normalizeParams(paramsInput);
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
    messageHex: isHex(message)
      ? message
      : `0x${Buffer.from(message).toString("hex")}`,
    address,
    displayMessage,
  };
}

export function parseSendTransaction(
  paramsInput: unknown,
  chainId: number,
): SendTransactionRequest {
  const params = normalizeParams(paramsInput);
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

export function parseSolanaSignMessage(
  params: unknown,
): SolanaSignMessageRequest {
  let paramObj: Record<string, unknown>;
  if (Array.isArray(params)) {
    paramObj = (params[0] as Record<string, unknown>) || {};
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

export function parseSolanaSignTransaction(
  params: unknown,
): SolanaSignTransactionRequest {
  let paramObj: Record<string, unknown>;
  if (Array.isArray(params)) {
    paramObj = (params[0] as Record<string, unknown>) || {};
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

export function parseSolanaSignAndSendTransaction(
  params: unknown,
): SolanaSignAndSendTransactionRequest {
  let paramObj: Record<string, unknown>;
  if (Array.isArray(params)) {
    paramObj = (params[0] as Record<string, unknown>) || {};
  } else {
    paramObj = params as Record<string, unknown>;
  }

  const transaction = (paramObj.transaction as string) || "";
  const pubkey = (paramObj.pubkey as string) || "";

  return {
    method: "solana_signAndSendTransaction",
    transaction,
    pubkey,
  };
}

export function parseSolanaSignAllTransactions(
  params: unknown,
): SolanaSignAllTransactionsRequest {
  // WalletConnect Solana params can be either:
  // 1. An object directly: { transactions, pubkey }
  // 2. An array with object: [{ transactions, pubkey }]
  let paramObj: Record<string, unknown>;
  if (Array.isArray(params)) {
    paramObj = (params[0] as Record<string, unknown>) || {};
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
  method:
    | "eth_signTypedData"
    | "eth_signTypedData_v1"
    | "eth_signTypedData_v3"
    | "eth_signTypedData_v4",
  paramsInput: unknown,
): SignTypedDataRequest {
  const params = normalizeParams(paramsInput);
  // common forms: [address, typedData], [typedData, address], or object payload
  let address = "0x0000000000000000000000000000000000000000" as `0x${string}`;
  let raw: unknown;

  if (typeof params[0] === "string" && (params[0] as string).startsWith("0x")) {
    address = params[0] as `0x${string}`;
    raw = params[1];
  } else if (
    typeof params[1] === "string" &&
    (params[1] as string).startsWith("0x")
  ) {
    address = params[1] as `0x${string}`;
    raw = params[0];
  } else {
    raw = params[1] ?? params[0];
  }

  let typedData: SignTypedDataRequest["typedData"];
  if (typeof raw === "string") {
    typedData = JSON.parse(raw);
  } else {
    typedData = (raw || {}) as SignTypedDataRequest["typedData"];
  }

  const domainName = (typedData.domain as Record<string, unknown>)?.name as
    | string
    | undefined;
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
  params: unknown,
  chainId: number,
  isSolana: boolean = false,
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

    case "eth_signTypedData_v1":
      return parseSignTypedData("eth_signTypedData_v1", params);

    case "eth_signTypedData_v3":
      return parseSignTypedData("eth_signTypedData_v3", params);

    case "eth_signTypedData_v4":
      return parseSignTypedData("eth_signTypedData_v4", params);

    case "solana_signMessage":
      return parseSolanaSignMessage(params);

    case "solana_signTransaction":
      return parseSolanaSignTransaction(params);

    case "solana_signAndSendTransaction":
      return parseSolanaSignAndSendTransaction(params);

    case "solana_signAllTransactions":
      return parseSolanaSignAllTransactions(params);

    default:
      return null;
  }
}

export function modifyTransactionData(
  originalData: `0x${string}`,
  newAmount: bigint,
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
