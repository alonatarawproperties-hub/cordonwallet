import { Connection, PublicKey } from "@solana/web3.js";
import {
  getMint,
  getExtensionTypes,
  ExtensionType,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type SecurityStatus = "safe" | "caution" | "warning" | "not_supported" | "unable";

export type RowKind = "verified" | "signal";

export interface SecurityRow {
  id: string;
  title: string;
  subtitle: string;
  status: SecurityStatus;
  badgeText: string;
  kind: RowKind;
  details?: string[];
}

export interface SecurityReport {
  mint: string;
  program: "spl" | "token2022";
  scannedAt: number;
  rows: SecurityRow[];
}

const CACHE_KEY_PREFIX = "cordon_security_scan_";
const CACHE_TTL_MS = 60 * 60 * 1000;

const RISKY_EXTENSIONS = new Set([
  ExtensionType.TransferHook,
  ExtensionType.PermanentDelegate,
  ExtensionType.DefaultAccountState,
  ExtensionType.TransferFeeConfig,
  ExtensionType.ConfidentialTransferMint,
  ExtensionType.NonTransferable,
]);

const EXTENSION_NAMES: Partial<Record<ExtensionType, string>> = {
  [ExtensionType.TransferFeeConfig]: "TransferFee",
  [ExtensionType.TransferFeeAmount]: "TransferFeeAmount",
  [ExtensionType.MintCloseAuthority]: "MintCloseAuthority",
  [ExtensionType.ConfidentialTransferMint]: "ConfidentialTransfer",
  [ExtensionType.ConfidentialTransferAccount]: "ConfidentialAccount",
  [ExtensionType.DefaultAccountState]: "DefaultAccountState",
  [ExtensionType.ImmutableOwner]: "ImmutableOwner",
  [ExtensionType.MemoTransfer]: "MemoTransfer",
  [ExtensionType.NonTransferable]: "NonTransferable",
  [ExtensionType.InterestBearingConfig]: "InterestBearing",
  [ExtensionType.CpiGuard]: "CpiGuard",
  [ExtensionType.PermanentDelegate]: "PermanentDelegate",
  [ExtensionType.TransferHook]: "TransferHook",
  [ExtensionType.TransferHookAccount]: "TransferHookAccount",
  [ExtensionType.MetadataPointer]: "MetadataPointer",
  [ExtensionType.TokenMetadata]: "TokenMetadata",
  [ExtensionType.GroupPointer]: "GroupPointer",
  [ExtensionType.GroupMemberPointer]: "GroupMember",
};

const EXTENSION_RISK_EXPLANATIONS: Partial<Record<ExtensionType, { status: SecurityStatus; explanation: string }>> = {
  [ExtensionType.TransferHook]: { status: "warning", explanation: "Transfers can be gated by another program" },
  [ExtensionType.PermanentDelegate]: { status: "warning", explanation: "Someone can transfer/burn your tokens anytime" },
  [ExtensionType.DefaultAccountState]: { status: "warning", explanation: "New accounts are frozen by default" },
  [ExtensionType.TransferFeeConfig]: { status: "caution", explanation: "Token charges transfer fees" },
  [ExtensionType.ConfidentialTransferMint]: { status: "caution", explanation: "Transfer amounts can be hidden" },
  [ExtensionType.NonTransferable]: { status: "caution", explanation: "Token cannot be transferred" },
  [ExtensionType.InterestBearingConfig]: { status: "caution", explanation: "Balance changes over time" },
};

export async function getTokenProgramForMint(
  connection: Connection,
  mintPubkey: PublicKey
): Promise<"spl" | "token2022" | null> {
  try {
    const info = await connection.getAccountInfo(mintPubkey);
    if (!info) return null;
    const owner = info.owner.toBase58();
    if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) return "token2022";
    if (owner === TOKEN_PROGRAM_ID.toBase58()) return "spl";
    return null;
  } catch {
    return null;
  }
}

async function fetchMetaplexMetadata(
  connection: Connection,
  mintPubkey: PublicKey
): Promise<{ exists: boolean; isMutable?: boolean; updateAuthority?: string } | null> {
  try {
    const METAPLEX_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
    const [metadataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("metadata"), METAPLEX_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
      METAPLEX_PROGRAM_ID
    );
    const info = await connection.getAccountInfo(metadataPda);
    if (!info || info.data.length < 67) {
      return { exists: false };
    }
    const isMutable = info.data[66] === 1;
    let updateAuthority: string | undefined;
    if (info.data.length >= 33) {
      const authorityBytes = info.data.slice(1, 33);
      updateAuthority = new PublicKey(authorityBytes).toBase58();
    }
    return { exists: true, isMutable, updateAuthority };
  } catch (err) {
    console.error("[securityScan] Metaplex fetch error:", err);
    return null;
  }
}

async function fetchHolderConcentration(
  connection: Connection,
  mintPubkey: PublicKey,
  totalSupply: bigint
): Promise<{ top1Pct: number; top5Pct: number; top10Pct: number } | null> {
  try {
    const result = await connection.getTokenLargestAccounts(mintPubkey);
    if (!result.value || result.value.length === 0) return null;
    const sorted = result.value
      .map(a => BigInt(a.amount))
      .sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));
    const supply = Number(totalSupply);
    if (supply === 0) return null;
    const top1 = sorted.slice(0, 1).reduce((acc, v) => acc + Number(v), 0);
    const top5 = sorted.slice(0, 5).reduce((acc, v) => acc + Number(v), 0);
    const top10 = sorted.slice(0, 10).reduce((acc, v) => acc + Number(v), 0);
    return {
      top1Pct: (top1 / supply) * 100,
      top5Pct: (top5 / supply) * 100,
      top10Pct: (top10 / supply) * 100,
    };
  } catch (err) {
    console.error("[securityScan] Holder concentration error:", err);
    return null;
  }
}

async function probeJupiterLiquidity(
  inputMint: string,
  outputMint: string,
  amountAtomic: string,
  slippageBps: number = 100
): Promise<{ hasRoute: boolean; priceImpactPct?: number; error?: string }> {
  try {
    const url = new URL("https://lite-api.jup.ag/swap/v1/quote");
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", amountAtomic);
    url.searchParams.set("slippageBps", slippageBps.toString());
    const resp = await fetch(url.toString(), { method: "GET" });
    if (!resp.ok) {
      return { hasRoute: false, error: `HTTP ${resp.status}` };
    }
    const data = await resp.json();
    if (!data.routePlan || data.routePlan.length === 0 || data.outAmount === "0") {
      return { hasRoute: false };
    }
    const priceImpactPct = data.priceImpactPct ? parseFloat(data.priceImpactPct) : 0;
    return { hasRoute: true, priceImpactPct };
  } catch (err: any) {
    console.error("[securityScan] Jupiter probe error:", err);
    return { hasRoute: false, error: err.message || "Network error" };
  }
}

export interface ScanParams {
  connection: Connection;
  mint: string;
  userBalanceAtomic?: string;
  decimals?: number;
}

export async function scanTokenSecurity(params: ScanParams): Promise<SecurityReport> {
  const { connection, mint } = params;
  const rows: SecurityRow[] = [];
  const now = Date.now();

  let mintPubkey: PublicKey;
  try {
    mintPubkey = new PublicKey(mint);
  } catch {
    return {
      mint,
      program: "spl",
      scannedAt: now,
      rows: [{
        id: "error",
        title: "Invalid Mint Address",
        subtitle: "Could not parse mint address",
        status: "unable",
        badgeText: "Unable to verify",
        kind: "verified",
      }],
    };
  }

  const program = await getTokenProgramForMint(connection, mintPubkey);
  if (!program) {
    return {
      mint,
      program: "spl",
      scannedAt: now,
      rows: [{
        id: "error",
        title: "Mint Not Found",
        subtitle: "Account does not exist on-chain",
        status: "unable",
        badgeText: "Unable to verify",
        kind: "verified",
      }],
    };
  }

  const programId = program === "token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  let mintInfo;
  try {
    mintInfo = await getMint(connection, mintPubkey, "confirmed", programId);
  } catch (err) {
    console.error("[securityScan] getMint error:", err);
    return {
      mint,
      program,
      scannedAt: now,
      rows: [{
        id: "error",
        title: "Unable to Read Mint",
        subtitle: "RPC call failed",
        status: "unable",
        badgeText: "Unable to verify",
        kind: "verified",
      }],
    };
  }

  rows.push({
    id: "program",
    title: "Token Program",
    subtitle: program === "token2022" ? "Token-2022 with extensions" : "Standard SPL Token",
    status: "safe",
    badgeText: program === "token2022" ? "Token-2022" : "SPL",
    kind: "verified",
  });

  if (mintInfo.mintAuthority === null) {
    rows.push({
      id: "mintable",
      title: "Mintable",
      subtitle: "Supply is fixed - no mint authority",
      status: "safe",
      badgeText: "Safe",
      kind: "verified",
    });
  } else {
    rows.push({
      id: "mintable",
      title: "Mintable",
      subtitle: "Mint authority exists - supply can increase",
      status: "caution",
      badgeText: "Caution",
      kind: "verified",
    });
  }

  if (mintInfo.freezeAuthority === null) {
    rows.push({
      id: "freezable",
      title: "Freezable",
      subtitle: "No freeze authority - accounts are safe",
      status: "safe",
      badgeText: "Safe",
      kind: "verified",
    });
  } else {
    rows.push({
      id: "freezable",
      title: "Freezable",
      subtitle: "Freeze authority exists - issuer can freeze accounts",
      status: "warning",
      badgeText: "Warning",
      kind: "verified",
    });
  }

  if (program === "token2022") {
    try {
      const accountInfo = await connection.getAccountInfo(mintPubkey);
      if (accountInfo) {
        const extensions = getExtensionTypes(accountInfo.data);
        if (extensions.length > 0) {
          const riskyExts = extensions.filter(e => RISKY_EXTENSIONS.has(e));
          const extNames = extensions.map(e => EXTENSION_NAMES[e] || `Type${e}`);
          if (riskyExts.length > 0) {
            const riskyNames = riskyExts.map(e => EXTENSION_NAMES[e] || `Type${e}`);
            const firstRisky = riskyExts[0];
            const riskInfo = EXTENSION_RISK_EXPLANATIONS[firstRisky];
            rows.push({
              id: "extensions",
              title: "Token Extensions",
              subtitle: riskInfo?.explanation || `Risky extensions: ${riskyNames.join(", ")}`,
              status: riskInfo?.status || "warning",
              badgeText: riskInfo?.status === "warning" ? "Warning" : "Caution",
              kind: "verified",
              details: [`Extensions: ${extNames.join(", ")}`],
            });
          } else {
            rows.push({
              id: "extensions",
              title: "Token Extensions",
              subtitle: `${extensions.length} extension(s) detected`,
              status: "safe",
              badgeText: "Safe",
              kind: "verified",
              details: [`Extensions: ${extNames.join(", ")}`],
            });
          }
        } else {
          rows.push({
            id: "extensions",
            title: "Token Extensions",
            subtitle: "No extensions detected",
            status: "safe",
            badgeText: "Safe",
            kind: "verified",
          });
        }
      }
    } catch (err) {
      console.error("[securityScan] Extension parsing error:", err);
      rows.push({
        id: "extensions",
        title: "Token Extensions",
        subtitle: "Extension decoding not supported yet",
        status: "not_supported",
        badgeText: "Not supported",
        kind: "verified",
      });
    }
  }

  const metadataResult = await fetchMetaplexMetadata(connection, mintPubkey);
  if (metadataResult === null) {
    rows.push({
      id: "metadata",
      title: "Metadata Immutable",
      subtitle: "Unable to verify - RPC error",
      status: "unable",
      badgeText: "Unable to verify",
      kind: "verified",
    });
  } else if (!metadataResult.exists) {
    rows.push({
      id: "metadata",
      title: "Metadata Immutable",
      subtitle: "No Metaplex metadata found",
      status: "not_supported",
      badgeText: "Not available",
      kind: "verified",
    });
  } else if (metadataResult.isMutable === false) {
    rows.push({
      id: "metadata",
      title: "Metadata Immutable",
      subtitle: "Metadata cannot be changed",
      status: "safe",
      badgeText: "Safe",
      kind: "verified",
    });
  } else {
    rows.push({
      id: "metadata",
      title: "Metadata Immutable",
      subtitle: "Metadata can be changed by update authority",
      status: "caution",
      badgeText: "Caution",
      kind: "verified",
    });
  }

  const concentration = await fetchHolderConcentration(connection, mintPubkey, mintInfo.supply);
  if (concentration) {
    const { top1Pct, top10Pct } = concentration;
    let status: SecurityStatus = "safe";
    let badgeText = "Safe";
    if (top1Pct > 15 || top10Pct > 70) {
      status = "warning";
      badgeText = "Warning";
    } else if (top1Pct > 10 || top10Pct > 50) {
      status = "caution";
      badgeText = "Caution";
    }
    rows.push({
      id: "holders",
      title: "Holder Concentration",
      subtitle: `Top 1: ${top1Pct.toFixed(1)}% • Top 10: ${top10Pct.toFixed(1)}%`,
      status,
      badgeText,
      kind: "signal",
      details: ["Signal — may include LP/treasury accounts"],
    });
  } else {
    rows.push({
      id: "holders",
      title: "Holder Concentration",
      subtitle: "Unable to fetch holder data",
      status: "unable",
      badgeText: "Unable to verify",
      kind: "signal",
    });
  }

  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const isSOL = mint === SOL_MINT;
  if (isSOL) {
    rows.push({
      id: "liquidity",
      title: "Route Liquidity",
      subtitle: "Native SOL - highly liquid",
      status: "safe",
      badgeText: "Safe",
      kind: "signal",
    });
  } else {
    const probeAmount = "50000000";
    const probeResult = await probeJupiterLiquidity(SOL_MINT, mint, probeAmount);
    if (!probeResult.hasRoute) {
      rows.push({
        id: "liquidity",
        title: "Route Liquidity",
        subtitle: "Low liquidity or not tradable",
        status: "warning",
        badgeText: "Warning",
        kind: "signal",
        details: ["Signal — based on Jupiter route availability"],
      });
    } else {
      const impact = probeResult.priceImpactPct || 0;
      let status: SecurityStatus = "safe";
      let badgeText = "Safe";
      if (impact >= 5) {
        status = "warning";
        badgeText = "Warning";
      } else if (impact >= 1) {
        status = "caution";
        badgeText = "Caution";
      }
      rows.push({
        id: "liquidity",
        title: "Route Liquidity",
        subtitle: `Price impact: ${impact.toFixed(2)}%`,
        status,
        badgeText,
        kind: "signal",
        details: ["Signal — based on Jupiter route and price impact"],
      });
    }
  }

  return {
    mint,
    program,
    scannedAt: now,
    rows,
  };
}

export async function loadCachedSecurityReport(mint: string): Promise<{ report: SecurityReport | null; isStale: boolean }> {
  try {
    const key = CACHE_KEY_PREFIX + mint;
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return { report: null, isStale: true };
    const parsed = JSON.parse(stored) as { ts: number; report: SecurityReport };
    const isStale = Date.now() - parsed.ts > CACHE_TTL_MS;
    return { report: parsed.report, isStale };
  } catch {
    return { report: null, isStale: true };
  }
}

export async function saveCachedSecurityReport(mint: string, report: SecurityReport): Promise<void> {
  try {
    const key = CACHE_KEY_PREFIX + mint;
    await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), report }));
  } catch (err) {
    console.error("[securityScan] Cache save error:", err);
  }
}

export function getStatusColor(status: SecurityStatus): string {
  switch (status) {
    case "safe": return "#22C55E";
    case "caution": return "#F59E0B";
    case "warning": return "#EF4444";
    case "not_supported": return "#6B7280";
    case "unable": return "#6B7280";
  }
}

export function getStatusIcon(status: SecurityStatus): "check-circle" | "alert-triangle" | "alert-octagon" | "help-circle" | "info" {
  switch (status) {
    case "safe": return "check-circle";
    case "caution": return "alert-triangle";
    case "warning": return "alert-octagon";
    case "not_supported": return "info";
    case "unable": return "help-circle";
  }
}

export function formatScanTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
