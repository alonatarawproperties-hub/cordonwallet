import { useState, useEffect, useCallback, useRef } from "react";
import { Connection } from "@solana/web3.js";
import { RPC_PRIMARY } from "@/constants/solanaSwap";
import { getTokenSafetyV2 } from "@/services/tokenSafetyV2";
import { TokenSafetyReportV2, SafetyFinding } from "@/types/tokenSafety";

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
  v2Report?: TokenSafetyReportV2;
}

interface ScanOptions {
  routeSource?: "jupiter" | "pump" | null;
  forceRescan?: boolean;
}

function mapV2ToLegacyResult(report: TokenSafetyReportV2, isPump: boolean): TokenSafetyResult {
  let riskLevel: RiskLevel;
  switch (report.verdict.level) {
    case "danger":
      riskLevel = "HIGH";
      break;
    case "warning":
      riskLevel = "MEDIUM";
      break;
    case "safe":
    default:
      riskLevel = "LOW";
      break;
  }

  const hasUnverified = report.findings.some(f => f.verified === "not_verified");
  if (hasUnverified && riskLevel === "LOW") {
    riskLevel = "NEEDS_DEEPER_SCAN";
  }

  const checks: SafetyCheck[] = report.findings.map((finding: SafetyFinding) => ({
    id: finding.key,
    title: finding.title,
    status: mapLevelToStatus(finding.level, finding.verified),
    shortText: finding.summary,
    longText: finding.detail,
  }));

  if (isPump) {
    const hasPumpCheck = checks.some(c => c.id === "pump" || c.title.toLowerCase().includes("pump"));
    if (!hasPumpCheck) {
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
    }
  }

  return {
    mint: report.mint,
    riskLevel,
    checks,
    scannedAt: report.scannedAt,
    program: report.tokenProgram === "unknown" ? null : report.tokenProgram,
    isPump,
    v2Report: report,
  };
}

function mapLevelToStatus(level: string, verified: string): "safe" | "warning" | "info" | "unknown" {
  if (verified === "not_verified" || verified === "unavailable") {
    return "unknown";
  }
  switch (level) {
    case "safe": return "safe";
    case "warning": return "warning";
    case "danger": return "warning";
    case "info": return "info";
    default: return "info";
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
      const connection = new Connection(RPC_PRIMARY, "confirmed");
      const v2Report = await getTokenSafetyV2({
        connection,
        mint,
        forceRefresh: forceRescan,
      });
      
      const isPump = options.routeSource === "pump";
      const mappedResult = mapV2ToLegacyResult(v2Report, isPump);
      setResult(mappedResult);
    } catch (error) {
      if (__DEV__) console.warn("[useTokenSafetyScan] Scan failed:", error);
      setResult({
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
        isPump: options.routeSource === "pump",
      });
    } finally {
      setIsScanning(false);
      scanInProgress.current = false;
    }
  }, [mint, options.routeSource, result]);

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
