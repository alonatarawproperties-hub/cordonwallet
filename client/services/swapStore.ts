import AsyncStorage from "@react-native-async-storage/async-storage";
import { SwapSpeed } from "@/constants/solanaSwap";
import { TxStatus } from "./txBroadcaster";

const SWAP_HISTORY_KEY = "swap_history_v1";
const SWAP_LOGS_KEY = "swap_debug_logs_v1";
const MAX_HISTORY_ITEMS = 100;
const MAX_LOG_ITEMS = 20;

export interface SwapRecord {
  id: string;
  timestamp: number;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  inputAmount: string;
  outputAmount: string;
  minReceived: string;
  slippageBps: number;
  mode: SwapSpeed;
  capSol: number;
  signature: string;
  status: TxStatus;
  failureReason?: string;
  failureCategory?: string;
  timings: SwapTimings;
  route?: string;
  priceImpactPct?: number;
}

export interface SwapTimings {
  quoteLatencyMs?: number;
  buildLatencyMs?: number;
  tapToSubmittedMs?: number;
  submittedToProcessedMs?: number;
  processedToConfirmedMs?: number;
  totalMs?: number;
}

export interface SwapLogEntry {
  timestamp: number;
  level: "info" | "warn" | "error";
  message: string;
  data?: any;
}

let swapHistory: SwapRecord[] = [];
let debugLogs: SwapLogEntry[] = [];
let cacheLoaded = false;

async function loadFromStorage(): Promise<void> {
  if (cacheLoaded) return;
  
  try {
    const [historyJson, logsJson] = await Promise.all([
      AsyncStorage.getItem(SWAP_HISTORY_KEY),
      AsyncStorage.getItem(SWAP_LOGS_KEY),
    ]);
    
    if (historyJson) {
      swapHistory = JSON.parse(historyJson);
    }
    if (logsJson) {
      debugLogs = JSON.parse(logsJson);
    }
    
    cacheLoaded = true;
  } catch (error) {
    console.error("[SwapStore] Failed to load from storage:", error);
    cacheLoaded = true;
  }
}

async function saveHistory(): Promise<void> {
  try {
    await AsyncStorage.setItem(SWAP_HISTORY_KEY, JSON.stringify(swapHistory));
  } catch (error) {
    console.error("[SwapStore] Failed to save history:", error);
  }
}

async function saveLogs(): Promise<void> {
  try {
    await AsyncStorage.setItem(SWAP_LOGS_KEY, JSON.stringify(debugLogs));
  } catch (error) {
    console.error("[SwapStore] Failed to save logs:", error);
  }
}

export async function addSwapRecord(record: Omit<SwapRecord, "id">): Promise<SwapRecord> {
  await loadFromStorage();
  
  const fullRecord: SwapRecord = {
    ...record,
    id: `swap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
  
  swapHistory.unshift(fullRecord);
  
  if (swapHistory.length > MAX_HISTORY_ITEMS) {
    swapHistory = swapHistory.slice(0, MAX_HISTORY_ITEMS);
  }
  
  await saveHistory();
  return fullRecord;
}

export async function updateSwapStatus(
  id: string,
  status: TxStatus,
  updates?: Partial<SwapRecord>
): Promise<void> {
  await loadFromStorage();
  
  const index = swapHistory.findIndex(s => s.id === id);
  if (index !== -1) {
    swapHistory[index] = {
      ...swapHistory[index],
      status,
      ...updates,
    };
    await saveHistory();
  }
}

export async function getSwapHistory(): Promise<SwapRecord[]> {
  await loadFromStorage();
  return [...swapHistory];
}

export async function getSwapById(id: string): Promise<SwapRecord | null> {
  await loadFromStorage();
  return swapHistory.find(s => s.id === id) || null;
}

export async function getPendingSwaps(): Promise<SwapRecord[]> {
  await loadFromStorage();
  return swapHistory.filter(s => s.status === "submitted" || s.status === "processed");
}

export async function clearSwapHistory(): Promise<void> {
  swapHistory = [];
  await saveHistory();
}

export async function addDebugLog(
  level: "info" | "warn" | "error",
  message: string,
  data?: any
): Promise<void> {
  await loadFromStorage();
  
  const entry: SwapLogEntry = {
    timestamp: Date.now(),
    level,
    message,
    data,
  };
  
  debugLogs.unshift(entry);
  
  if (debugLogs.length > MAX_LOG_ITEMS) {
    debugLogs = debugLogs.slice(0, MAX_LOG_ITEMS);
  }
  
  await saveLogs();
  
  const logFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  logFn(`[SwapDebug] ${message}`, data || "");
}

export async function getDebugLogs(): Promise<SwapLogEntry[]> {
  await loadFromStorage();
  return [...debugLogs];
}

export async function clearDebugLogs(): Promise<void> {
  debugLogs = [];
  await saveLogs();
}

export function calculateSwapStats(records: SwapRecord[]): {
  totalSwaps: number;
  successfulSwaps: number;
  failedSwaps: number;
  successRate: number;
  avgConfirmationMs: number;
  modeDistribution: Record<SwapSpeed, number>;
  failureReasons: Record<string, number>;
} {
  const successful = records.filter(r => r.status === "confirmed" || r.status === "finalized");
  const failed = records.filter(r => r.status === "failed");
  
  const confirmationTimes = successful
    .map(r => r.timings.totalMs)
    .filter((t): t is number => t !== undefined);
  
  const modeDistribution: Record<SwapSpeed, number> = {
    standard: 0,
    fast: 0,
    turbo: 0,
  };
  records.forEach(r => {
    modeDistribution[r.mode]++;
  });
  
  const failureReasons: Record<string, number> = {};
  failed.forEach(r => {
    const reason = r.failureCategory || "unknown";
    failureReasons[reason] = (failureReasons[reason] || 0) + 1;
  });
  
  return {
    totalSwaps: records.length,
    successfulSwaps: successful.length,
    failedSwaps: failed.length,
    successRate: records.length > 0 ? (successful.length / records.length) * 100 : 0,
    avgConfirmationMs: confirmationTimes.length > 0
      ? confirmationTimes.reduce((a, b) => a + b, 0) / confirmationTimes.length
      : 0,
    modeDistribution,
    failureReasons,
  };
}

export function formatSwapForDisplay(record: SwapRecord): {
  title: string;
  subtitle: string;
  statusColor: string;
  statusText: string;
} {
  const statusColors: Record<TxStatus, string> = {
    submitted: "#FFA500",
    processed: "#3B82F6",
    confirmed: "#22C55E",
    finalized: "#22C55E",
    failed: "#EF4444",
    expired: "#F59E0B",
  };
  
  const statusTexts: Record<TxStatus, string> = {
    submitted: "Submitting...",
    processed: "Processing...",
    confirmed: "Confirmed",
    finalized: "Finalized",
    failed: "Failed",
    expired: "Expired",
  };
  
  return {
    title: `${record.inputSymbol} → ${record.outputSymbol}`,
    subtitle: `${record.inputAmount} ${record.inputSymbol}`,
    statusColor: statusColors[record.status],
    statusText: statusTexts[record.status],
  };
}
