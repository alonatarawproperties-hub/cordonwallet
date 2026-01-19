import { Connection, PublicKey } from "@solana/web3.js";
import {
  TokenSafetyReportV2,
  SafetyFinding,
  TokenSafetyStats,
  TokenSafetyHeuristics,
} from "@/types/tokenSafety";
import { getCached, setCached, getCacheKey } from "./cache";
import {
  detectTokenProgram,
  fetchMintCore,
  fetchMetadataInfo,
  fetchTopHolders,
  fetchAuthorityRecentActivity,
} from "./solanaMintInfo";
import { fetchDexMarketData } from "./dexMarketData";
import { computeVerdict } from "@/utils/riskScore";

const CACHE_PREFIX = "tokenSafetyV2";
const CACHE_TTL_MS = 5 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function solscanUrl(type: "account" | "token", address: string): string {
  return `https://solscan.io/${type}/${address}`;
}

export interface GetTokenSafetyV2Params {
  connection: Connection;
  mint: string;
  forceRefresh?: boolean;
}

export async function getTokenSafetyV2(
  params: GetTokenSafetyV2Params
): Promise<TokenSafetyReportV2> {
  const { connection, mint, forceRefresh } = params;
  const cacheKey = getCacheKey(CACHE_PREFIX, mint);

  if (!forceRefresh) {
    const cached = getCached<TokenSafetyReportV2>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const findings: SafetyFinding[] = [];
  const stats: TokenSafetyStats = {};
  const heuristics: TokenSafetyHeuristics = { notes: [] };

  let mintPubkey: PublicKey;
  try {
    mintPubkey = new PublicKey(mint);
  } catch {
    return createErrorReport(mint, "Invalid mint address");
  }

  const tokenProgram = await withTimeout(
    detectTokenProgram(connection, mintPubkey),
    3000,
    "unknown" as const
  );

  findings.push({
    key: "tokenProgram",
    title: "Token Program",
    level: tokenProgram === "token2022" ? "info" : "safe",
    summary:
      tokenProgram === "spl"
        ? "Standard SPL Token"
        : tokenProgram === "token2022"
        ? "Token-2022 (Extensions)"
        : "Unknown program",
    detail:
      tokenProgram === "spl"
        ? "This token uses the standard SPL Token program, which is widely supported."
        : tokenProgram === "token2022"
        ? "This token uses Token-2022, which may have extensions that affect transfers."
        : "Could not determine the token program. Proceed with caution.",
    verified: tokenProgram !== "unknown" ? "verified" : "not_verified",
    proof: [{ label: "Mint", value: mint, explorerUrl: solscanUrl("token", mint) }],
  });

  const mintCore = await withTimeout(
    fetchMintCore(connection, mintPubkey, tokenProgram),
    3000,
    null
  );

  if (mintCore) {
    stats.decimals = mintCore.decimals;
    stats.supply = (Number(mintCore.supply) / Math.pow(10, mintCore.decimals)).toLocaleString();

    const hasMintAuth = mintCore.mintAuthority !== null;
    findings.push({
      key: "mintable",
      title: "Mintable",
      level: hasMintAuth ? "warning" : "safe",
      summary: hasMintAuth ? "Mint authority exists" : "No mint authority",
      detail: hasMintAuth
        ? "The issuer can mint more tokens, potentially diluting your holdings."
        : "No one can mint more tokens. Supply is fixed.",
      verified: "verified",
      proof: hasMintAuth
        ? [
            {
              label: "Mint Authority",
              value: mintCore.mintAuthority!,
              explorerUrl: solscanUrl("account", mintCore.mintAuthority!),
            },
          ]
        : undefined,
    });

    const hasFreezeAuth = mintCore.freezeAuthority !== null;
    findings.push({
      key: "freezable",
      title: "Freezable",
      level: hasFreezeAuth ? "warning" : "safe",
      summary: hasFreezeAuth ? "Freeze authority exists" : "No freeze authority",
      detail: hasFreezeAuth
        ? "The issuer can freeze token accounts, preventing transfers."
        : "No one can freeze your token account.",
      verified: "verified",
      proof: hasFreezeAuth
        ? [
            {
              label: "Freeze Authority",
              value: mintCore.freezeAuthority!,
              explorerUrl: solscanUrl("account", mintCore.freezeAuthority!),
            },
          ]
        : undefined,
    });

    if (mintCore.mintAuthority) {
      heuristics.deployerOrAuthority = mintCore.mintAuthority;
    }
  } else {
    findings.push({
      key: "mintable",
      title: "Mintable",
      level: "info",
      summary: "Not verified yet",
      detail: "Could not fetch mint info from the blockchain.",
      verified: "not_verified",
    });
    findings.push({
      key: "freezable",
      title: "Freezable",
      level: "info",
      summary: "Not verified yet",
      detail: "Could not fetch mint info from the blockchain.",
      verified: "not_verified",
    });
  }

  const metadata = await withTimeout(fetchMetadataInfo(connection, mintPubkey), 3000, null);

  if (metadata) {
    findings.push({
      key: "metadataImmutable",
      title: "Metadata Immutability",
      level: metadata.isMutable ? "warning" : "safe",
      summary: metadata.isMutable ? "Mutable metadata" : "Immutable metadata",
      detail: metadata.isMutable
        ? "The issuer can change token metadata (name, symbol, image)."
        : "Token metadata is locked and cannot be changed.",
      verified: "verified",
      proof: metadata.updateAuthority
        ? [
            {
              label: "Update Authority",
              value: metadata.updateAuthority,
              explorerUrl: solscanUrl("account", metadata.updateAuthority),
            },
          ]
        : undefined,
    });

    if (metadata.updateAuthority) {
      heuristics.deployerOrAuthority = metadata.updateAuthority;
    }
  } else {
    findings.push({
      key: "metadataImmutable",
      title: "Metadata Immutability",
      level: "info",
      summary: "Not verified yet",
      detail: "Metaplex metadata not found or could not be parsed.",
      verified: "not_verified",
    });
  }

  if (mintCore) {
    const holders = await withTimeout(
      fetchTopHolders(connection, mintPubkey, mintCore.supply, mintCore.decimals),
      4000,
      null
    );

    if (holders) {
      stats.topHoldersPct = Math.round(holders.topPct * 10) / 10;
      stats.topHoldersCount = holders.topCount;

      const pct = holders.topPct;
      const level = pct > 40 ? "danger" : pct > 20 ? "warning" : "safe";
      findings.push({
        key: "holderConcentration",
        title: "Holder Concentration",
        level,
        summary: `Top ${holders.topCount} hold ${pct.toFixed(1)}%`,
        detail:
          pct > 40
            ? "High concentration. A few wallets control most of the supply, creating dump risk."
            : pct > 20
            ? "Moderate concentration. Some large holders exist."
            : "Healthy distribution among holders.",
        verified: "verified",
        proof: holders.largestAccounts.slice(0, 3).map((acc, i) => ({
          label: `#${i + 1} Holder`,
          value: `${acc.uiAmount.toLocaleString()} tokens`,
          explorerUrl: solscanUrl("account", acc.address),
        })),
      });
    } else {
      findings.push({
        key: "holderConcentration",
        title: "Holder Concentration",
        level: "info",
        summary: "Not verified yet",
        detail: "Could not fetch token holder data.",
        verified: "not_verified",
      });
    }
  }

  const dexData = await withTimeout(fetchDexMarketData(mint), 5000, null);

  if (dexData) {
    stats.liquidityUsd = dexData.liquidityUsd;
    stats.volume24hUsd = dexData.volume24hUsd;
    stats.fdvUsd = dexData.fdvUsd;
    stats.marketCapUsd = dexData.marketCapUsd;

    const liq = dexData.liquidityUsd;
    const liqLevel = liq >= 50000 ? "safe" : liq >= 10000 ? "warning" : "danger";
    findings.push({
      key: "liquidity",
      title: "Liquidity",
      level: liqLevel,
      summary:
        liq >= 50000
          ? `$${(liq / 1000).toFixed(0)}k liquidity`
          : liq >= 10000
          ? `$${(liq / 1000).toFixed(1)}k liquidity (low)`
          : liq > 0
          ? `$${liq.toFixed(0)} liquidity (very low)`
          : "No liquidity found",
      detail:
        liq >= 50000
          ? "Good liquidity for trading with minimal slippage."
          : liq >= 10000
          ? "Low liquidity may cause higher slippage on trades."
          : "Very low or no liquidity. Trading may be difficult or result in large losses.",
      verified: "verified",
      proof: dexData.url
        ? [{ label: "DEX Pool", value: dexData.dexId ?? "Pool", explorerUrl: dexData.url }]
        : undefined,
    });

    const vol = dexData.volume24hUsd;
    if (vol > 0) {
      const volToLiq = liq > 0 ? vol / liq : 0;
      const isSuspicious = volToLiq > 8;

      if (isSuspicious) {
        heuristics.suspiciousVolume = true;
        heuristics.notes?.push("Volume unusually high vs liquidity");
      }

      findings.push({
        key: "volume24h",
        title: "24h Volume",
        level: isSuspicious ? "warning" : "info",
        summary: `$${vol >= 1000 ? (vol / 1000).toFixed(1) + "k" : vol.toFixed(0)} traded`,
        detail: isSuspicious
          ? "Volume is unusually high compared to liquidity. This may indicate wash trading. (Heuristic)"
          : "Recent trading activity on decentralized exchanges.",
        verified: "verified",
        isHeuristic: isSuspicious,
      });
    }
  } else {
    findings.push({
      key: "liquidity",
      title: "Liquidity",
      level: "warning",
      summary: "No pool found",
      detail: "No DEX liquidity pool found for this token.",
      verified: "not_verified",
    });
  }

  if (heuristics.deployerOrAuthority) {
    const activity = await withTimeout(
      fetchAuthorityRecentActivity(connection, heuristics.deployerOrAuthority),
      2500,
      { isActive: false, signatureCount: 0 }
    );

    if (activity.isActive) {
      heuristics.authorityChangedRecently = true;
      findings.push({
        key: "authorityActivity",
        title: "Authority Activity",
        level: "info",
        summary: "Authority wallet active recently",
        detail:
          "The update/mint authority wallet has recent transactions. This is normal but worth noting. (Heuristic)",
        verified: "verified",
        isHeuristic: true,
        proof: [
          {
            label: "Authority",
            value: heuristics.deployerOrAuthority,
            explorerUrl: solscanUrl("account", heuristics.deployerOrAuthority),
          },
        ],
      });
    }
  }

  const verdict = computeVerdict(findings);

  const report: TokenSafetyReportV2 = {
    mint,
    chain: "solana",
    tokenProgram,
    scannedAt: Date.now(),
    sourceLabel: "Scanned by Cordon",
    findings,
    stats,
    heuristics,
    verdict,
  };

  setCached(cacheKey, report, CACHE_TTL_MS);

  return report;
}

function createErrorReport(mint: string, reason: string): TokenSafetyReportV2 {
  return {
    mint,
    chain: "solana",
    tokenProgram: "unknown",
    scannedAt: Date.now(),
    sourceLabel: "Scanned by Cordon",
    findings: [
      {
        key: "error",
        title: "Scan Error",
        level: "danger",
        summary: "Could not complete scan",
        detail: reason,
        verified: "not_verified",
      },
    ],
    verdict: {
      label: "High Risk",
      level: "danger",
      reasons: [reason],
    },
  };
}
