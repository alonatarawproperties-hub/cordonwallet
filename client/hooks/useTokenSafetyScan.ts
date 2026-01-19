import { useState, useEffect, useCallback, useRef } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getMint,
  getExtensionTypes,
  ExtensionType,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { RPC_PRIMARY } from "@/constants/solanaSwap";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "NEEDS_DEEPER_SCAN";

export interface SafetyCheck {
  id: string;
  title: string;
  status: "safe" | "warning" | "info" | "unknown";
  shortText: string;
  longText: string;
}

export interface TokenSafetyResult {
  mint: string;
  riskLevel: RiskLevel;
  checks: SafetyCheck[];
  scannedAt: number;
  program: "spl" | "token2022" | null;
  isPump: boolean;
}

interface ScanOptions {
  routeSource?: "jupiter" | "pump" | null;
  forceRescan?: boolean;
}

const CACHE_KEY_PREFIX = "cordon_swap_safety_";
const CACHE_TTL_MS = 10 * 60 * 1000;

const RISKY_EXTENSIONS = new Set([
  ExtensionType.TransferHook,
  ExtensionType.PermanentDelegate,
  ExtensionType.DefaultAccountState,
  ExtensionType.TransferFeeConfig,
  ExtensionType.ConfidentialTransferMint,
  ExtensionType.NonTransferable,
]);

async function getCachedResult(mint: string): Promise<TokenSafetyResult | null> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY_PREFIX + mint);
    if (!cached) return null;
    const result: TokenSafetyResult = JSON.parse(cached);
    if (Date.now() - result.scannedAt > CACHE_TTL_MS) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

async function setCachedResult(result: TokenSafetyResult): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY_PREFIX + result.mint, JSON.stringify(result));
  } catch {}
}

async function scanToken(
  mint: string,
  options: ScanOptions
): Promise<TokenSafetyResult> {
  const checks: SafetyCheck[] = [];
  let riskLevel: RiskLevel = "LOW";
  let program: "spl" | "token2022" | null = null;
  const isPump = options.routeSource === "pump";

  const connection = new Connection(RPC_PRIMARY, "confirmed");
  
  try {
    const mintPubkey = new PublicKey(mint);
    const accountInfo = await connection.getAccountInfo(mintPubkey);
    
    if (!accountInfo) {
      return {
        mint,
        riskLevel: "NEEDS_DEEPER_SCAN",
        checks: [{
          id: "account_error",
          title: "Account",
          status: "unknown",
          shortText: "Unable to verify",
          longText: "Unable to fetch token account from chain right now",
        }],
        scannedAt: Date.now(),
        program: null,
        isPump,
      };
    }

    const owner = accountInfo.owner.toBase58();
    const isToken2022 = owner === TOKEN_2022_PROGRAM_ID.toBase58();
    const isSplToken = owner === TOKEN_PROGRAM_ID.toBase58();
    
    if (!isToken2022 && !isSplToken) {
      return {
        mint,
        riskLevel: "NEEDS_DEEPER_SCAN",
        checks: [{
          id: "not_token",
          title: "Token Program",
          status: "unknown",
          shortText: "Not a token mint",
          longText: "This account is not owned by a token program",
        }],
        scannedAt: Date.now(),
        program: null,
        isPump,
      };
    }

    program = isToken2022 ? "token2022" : "spl";
    
    checks.push({
      id: "program",
      title: "Token Program",
      status: "info",
      shortText: isToken2022 ? "Token-2022 (extended)" : "SPL Token",
      longText: isToken2022 
        ? "Uses Token-2022 program with extended features"
        : "Standard SPL Token program",
    });

    const programId = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const mintInfo = await getMint(connection, mintPubkey, "confirmed", programId);
    
    const hasMintAuthority = mintInfo.mintAuthority !== null;
    const hasFreezeAuthority = mintInfo.freezeAuthority !== null;
    
    checks.push({
      id: "mintable",
      title: "Mintable",
      status: hasMintAuthority ? "warning" : "safe",
      shortText: hasMintAuthority ? "Supply can increase" : "Fixed supply",
      longText: hasMintAuthority 
        ? "Mint authority exists — supply can increase"
        : "No mint authority — supply is fixed",
    });
    
    checks.push({
      id: "freezable",
      title: "Freezable",
      status: hasFreezeAuthority ? "warning" : "safe",
      shortText: hasFreezeAuthority ? "Accounts can be frozen" : "Cannot be frozen",
      longText: hasFreezeAuthority
        ? "Freeze authority exists — accounts can be frozen"
        : "No freeze authority — accounts can't be frozen",
    });
    
    if (isToken2022) {
      try {
        const extensions = getExtensionTypes(accountInfo.data);
        if (extensions.length > 0) {
          const hasRiskyExtension = extensions.some(ext => RISKY_EXTENSIONS.has(ext));
          
          const extNames = extensions.map(ext => {
            switch (ext) {
              case ExtensionType.TransferHook: return "TransferHook";
              case ExtensionType.PermanentDelegate: return "PermanentDelegate";
              case ExtensionType.DefaultAccountState: return "DefaultAccountState";
              case ExtensionType.TransferFeeConfig: return "TransferFee";
              case ExtensionType.NonTransferable: return "NonTransferable";
              case ExtensionType.MetadataPointer: return "MetadataPointer";
              case ExtensionType.TokenMetadata: return "TokenMetadata";
              default: return `Extension(${ext})`;
            }
          });
          
          checks.push({
            id: "extensions",
            title: "Extensions",
            status: hasRiskyExtension ? "warning" : "info",
            shortText: `${extensions.length} extension${extensions.length > 1 ? "s" : ""}`,
            longText: hasRiskyExtension
              ? `Risky extensions detected: ${extNames.join(", ")}`
              : `Extensions: ${extNames.join(", ")}`,
          });
          
          if (hasRiskyExtension && riskLevel === "LOW") {
            riskLevel = "MEDIUM";
          }
        } else {
          checks.push({
            id: "extensions",
            title: "Extensions",
            status: "safe",
            shortText: "None",
            longText: "No Token-2022 extensions detected",
          });
        }
      } catch {
        checks.push({
          id: "extensions",
          title: "Extensions",
          status: "unknown",
          shortText: "Decoding coming in v2",
          longText: "Extensions present — decoding coming in v2",
        });
        if (riskLevel === "LOW") {
          riskLevel = "NEEDS_DEEPER_SCAN";
        }
      }
    }

    if (hasMintAuthority && hasFreezeAuthority) {
      riskLevel = "HIGH";
    } else if (hasMintAuthority || hasFreezeAuthority) {
      if (riskLevel === "LOW") riskLevel = "MEDIUM";
    }
    
    if (isPump) {
      checks.push({
        id: "pump",
        title: "Source",
        status: "warning",
        shortText: "Pump token",
        longText: "High volatility (Pump token) — bonding curve may have low liquidity",
      });
      
      if (riskLevel === "LOW") {
        riskLevel = "MEDIUM";
      }
      if ((hasMintAuthority || hasFreezeAuthority) && riskLevel !== "HIGH") {
        riskLevel = "HIGH";
      }
    }

    return {
      mint,
      riskLevel,
      checks,
      scannedAt: Date.now(),
      program,
      isPump,
    };
    
  } catch (error: any) {
    if (__DEV__) console.warn("[TokenSafetyScan] Error:", error.message);
    return {
      mint,
      riskLevel: "NEEDS_DEEPER_SCAN",
      checks: [{
        id: "scan_error",
        title: "Scan Error",
        status: "unknown",
        shortText: "Unable to verify",
        longText: "Unable to verify on-chain right now",
      }],
      scannedAt: Date.now(),
      program: null,
      isPump,
    };
  }
}

export interface UseTokenSafetyScanResult {
  result: TokenSafetyResult | null;
  isScanning: boolean;
  rescan: () => void;
  timeAgo: string;
}

export function useTokenSafetyScan(
  mint: string | null | undefined,
  options: ScanOptions = {}
): UseTokenSafetyScanResult {
  const [result, setResult] = useState<TokenSafetyResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [timeAgo, setTimeAgo] = useState("just now");
  const scanInProgress = useRef(false);
  const currentMint = useRef<string | null>(null);

  const doScan = useCallback(async (forceRescan = false) => {
    if (!mint || scanInProgress.current) return;
    
    if (!forceRescan && currentMint.current === mint && result) {
      return;
    }
    
    scanInProgress.current = true;
    currentMint.current = mint;
    setIsScanning(true);
    
    try {
      if (!forceRescan) {
        const cached = await getCachedResult(mint);
        if (cached) {
          if (cached.isPump !== (options.routeSource === "pump")) {
            cached.isPump = options.routeSource === "pump";
          }
          setResult(cached);
          setIsScanning(false);
          scanInProgress.current = false;
          return;
        }
      }
      
      const scanResult = await scanToken(mint, options);
      setResult(scanResult);
      await setCachedResult(scanResult);
    } catch (error) {
      if (__DEV__) console.warn("[useTokenSafetyScan] Scan failed:", error);
    } finally {
      setIsScanning(false);
      scanInProgress.current = false;
    }
  }, [mint, options.routeSource]);

  useEffect(() => {
    if (mint) {
      doScan(false);
    } else {
      setResult(null);
    }
  }, [mint, doScan]);

  useEffect(() => {
    if (!result) {
      setTimeAgo("just now");
      return;
    }
    
    const updateTimeAgo = () => {
      const diff = Date.now() - result.scannedAt;
      if (diff < 60000) {
        setTimeAgo("just now");
      } else if (diff < 3600000) {
        setTimeAgo(`${Math.floor(diff / 60000)}m ago`);
      } else {
        setTimeAgo(`${Math.floor(diff / 3600000)}h ago`);
      }
    };
    
    updateTimeAgo();
    const interval = setInterval(updateTimeAgo, 30000);
    return () => clearInterval(interval);
  }, [result]);

  const rescan = useCallback(() => {
    doScan(true);
  }, [doScan]);

  return { result, isScanning, rescan, timeAgo };
}
