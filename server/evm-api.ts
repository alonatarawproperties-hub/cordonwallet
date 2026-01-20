import type { Express, Request, Response } from "express";

const MORALIS_API_BASE = "https://deep-index.moralis.io/api/v2.2";

const CHAIN_ID_TO_MORALIS: Record<number, string> = {
  1: "eth",
  56: "bsc",
  137: "polygon",
  42161: "arbitrum",
};

const VALID_CHAIN_IDS = [1, 56, 137, 42161];

interface TokenDiscoveryToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string | null;
  balanceRaw: string;
  balanceFormatted: string;
  priceUsd: number | null;
  valueUsd: number | null;
}

interface TokenSecurityReport {
  overallRisk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  verifiedFacts: { label: string; status: "safe" | "warning" | "danger"; detail?: string }[];
  warnings: string[];
  unknowns: string[];
  sources: string[];
  scannedAt: number;
}

interface TokenBalanceCache {
  data: TokenDiscoveryToken[];
  timestamp: number;
}

interface TokenSecurityCache {
  data: TokenSecurityReport;
  timestamp: number;
}

const tokenBalanceCache: Map<string, TokenBalanceCache> = new Map();
const TOKEN_BALANCE_CACHE_TTL = 60000;

const tokenSecurityCache: Map<string, TokenSecurityCache> = new Map();
const TOKEN_SECURITY_CACHE_TTL = 300000;

function getMoralisApiKey(): string | undefined {
  return process.env.MORALIS_API_KEY;
}

async function fetchMoralisTokenBalances(
  chainId: number,
  address: string
): Promise<TokenDiscoveryToken[]> {
  const apiKey = getMoralisApiKey();
  if (!apiKey) {
    throw new Error("MORALIS_NOT_CONFIGURED");
  }

  const moralisChain = CHAIN_ID_TO_MORALIS[chainId];
  if (!moralisChain) {
    throw new Error(`MORALIS_UNSUPPORTED_CHAIN:${chainId}`);
  }

  const url = `${MORALIS_API_BASE}/${address}/erc20?chain=${moralisChain}&exclude_spam=true`;
  
  console.log(`[EVM API] Fetching tokens from Moralis for ${address} on ${moralisChain}`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  
  let fetchRes: globalThis.Response;
  try {
    fetchRes = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-API-Key": apiKey,
      },
      signal: controller.signal,
    });
  } catch (fetchError: any) {
    clearTimeout(timeoutId);
    if (fetchError.name === "AbortError" || fetchError.message?.includes("timeout")) {
      throw new Error("MORALIS_TIMEOUT");
    }
    throw new Error("MORALIS_NETWORK_ERROR");
  }
  clearTimeout(timeoutId);

  if (!fetchRes.ok) {
    const errorText = await fetchRes.text();
    console.error(`[EVM API] Moralis error: ${fetchRes.status}`, errorText);
    throw new Error(`MORALIS_STATUS:${fetchRes.status}`);
  }

  const data = await fetchRes.json();
  const tokens: TokenDiscoveryToken[] = [];

  if (Array.isArray(data)) {
    for (const token of data) {
      const decimals = parseInt(token.decimals) || 18;
      const balanceRaw = token.balance || "0";
      const balanceFormatted = (
        BigInt(balanceRaw) / BigInt(10 ** Math.min(decimals, 18))
      ).toString();

      tokens.push({
        address: token.token_address,
        symbol: token.symbol || "???",
        name: token.name || "Unknown Token",
        decimals,
        logoURI: token.logo || token.thumbnail || null,
        balanceRaw,
        balanceFormatted: formatTokenBalance(balanceRaw, decimals),
        priceUsd: token.usd_price || null,
        valueUsd: token.usd_value || null,
      });
    }
  }

  console.log(`[EVM API] Found ${tokens.length} tokens for ${address}`);
  return tokens;
}

function formatTokenBalance(raw: string, decimals: number): string {
  try {
    const num = BigInt(raw);
    const divisor = BigInt(10 ** decimals);
    const whole = num / divisor;
    const remainder = num % divisor;
    
    if (remainder === 0n) {
      return whole.toString();
    }
    
    const remainderStr = remainder.toString().padStart(decimals, "0");
    const trimmed = remainderStr.replace(/0+$/, "").slice(0, 6);
    
    if (trimmed === "") {
      return whole.toString();
    }
    
    return `${whole}.${trimmed}`;
  } catch {
    return "0";
  }
}

async function fetchMoralisTokenSecurity(
  chainId: number,
  tokenAddress: string
): Promise<TokenSecurityReport> {
  const apiKey = getMoralisApiKey();
  
  const report: TokenSecurityReport = {
    overallRisk: "UNKNOWN",
    verifiedFacts: [],
    warnings: [],
    unknowns: [],
    sources: [],
    scannedAt: Date.now(),
  };

  if (!apiKey) {
    report.unknowns.push("External scan unavailable (API not configured)");
    return report;
  }

  const moralisChain = CHAIN_ID_TO_MORALIS[chainId];
  if (!moralisChain) {
    report.unknowns.push(`Chain ${chainId} not supported for security scan`);
    return report;
  }

  try {
    const url = `${MORALIS_API_BASE}/erc20/${tokenAddress}/token-stats?chain=${moralisChain}`;
    
    console.log(`[EVM API] Fetching token security for ${tokenAddress} on ${moralisChain}`);
    
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-API-Key": apiKey,
      },
    });

    if (response.ok) {
      const data = await response.json();
      report.sources.push("Moralis Token Stats");
      
      if (data.total_holders !== undefined) {
        const holders = parseInt(data.total_holders);
        if (holders < 50) {
          report.warnings.push(`Very few holders: ${holders}`);
        } else if (holders < 500) {
          report.verifiedFacts.push({
            label: "Holder Count",
            status: "warning",
            detail: `${holders} holders`,
          });
        } else {
          report.verifiedFacts.push({
            label: "Holder Count",
            status: "safe",
            detail: `${holders} holders`,
          });
        }
      }

      if (data.total_supply_formatted) {
        report.verifiedFacts.push({
          label: "Total Supply",
          status: "safe",
          detail: data.total_supply_formatted,
        });
      }
    }
  } catch (error: any) {
    console.error(`[EVM API] Token stats error:`, error.message);
    report.unknowns.push("Token statistics unavailable");
  }

  try {
    const metaUrl = `${MORALIS_API_BASE}/erc20/metadata?chain=${moralisChain}&addresses[]=${tokenAddress}`;
    
    const metaResponse = await fetch(metaUrl, {
      headers: {
        "Accept": "application/json",
        "X-API-Key": apiKey,
      },
    });

    if (metaResponse.ok) {
      const metaData = await metaResponse.json();
      if (Array.isArray(metaData) && metaData.length > 0) {
        const meta = metaData[0];
        
        if (meta.verified_contract !== undefined) {
          if (meta.verified_contract) {
            report.verifiedFacts.push({
              label: "Contract Verified",
              status: "safe",
              detail: "Source code verified on explorer",
            });
          } else {
            report.warnings.push("Contract source code not verified");
          }
        }

        if (meta.security_score !== undefined) {
          const score = parseInt(meta.security_score);
          if (score >= 80) {
            report.verifiedFacts.push({
              label: "Security Score",
              status: "safe",
              detail: `${score}/100`,
            });
          } else if (score >= 50) {
            report.verifiedFacts.push({
              label: "Security Score",
              status: "warning",
              detail: `${score}/100`,
            });
          } else {
            report.warnings.push(`Low security score: ${score}/100`);
          }
        }
      }
    }
  } catch (error: any) {
    console.error(`[EVM API] Token metadata error:`, error.message);
  }

  const dangerCount = report.warnings.length;
  const warningCount = report.verifiedFacts.filter(f => f.status === "warning").length;
  const safeCount = report.verifiedFacts.filter(f => f.status === "safe").length;

  if (dangerCount >= 2) {
    report.overallRisk = "HIGH";
  } else if (dangerCount >= 1 || warningCount >= 2) {
    report.overallRisk = "MEDIUM";
  } else if (safeCount >= 2) {
    report.overallRisk = "LOW";
  } else {
    report.overallRisk = "UNKNOWN";
    if (report.unknowns.length === 0) {
      report.unknowns.push("Insufficient data for full assessment");
    }
  }

  return report;
}

async function fetchMoralisApprovals(
  chainId: number,
  address: string
): Promise<{
  approvals: {
    tokenAddress: string;
    tokenSymbol: string;
    spenderAddress: string;
    spenderName: string | null;
    allowance: string;
    isUnlimited: boolean;
    isRisky: boolean;
    riskReason: string | null;
  }[];
  riskLevel: "none" | "some" | "high";
}> {
  const apiKey = getMoralisApiKey();
  
  if (!apiKey) {
    return { approvals: [], riskLevel: "none" };
  }

  const moralisChain = CHAIN_ID_TO_MORALIS[chainId];
  if (!moralisChain) {
    return { approvals: [], riskLevel: "none" };
  }

  try {
    const url = `${MORALIS_API_BASE}/wallets/${address}/approvals?chain=${moralisChain}`;
    
    console.log(`[EVM API] Fetching approvals for ${address} on ${moralisChain}`);
    
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "X-API-Key": apiKey,
      },
    });

    if (!response.ok) {
      console.error(`[EVM API] Approvals error: ${response.status}`);
      return { approvals: [], riskLevel: "none" };
    }

    const data = await response.json();
    const approvals: {
      tokenAddress: string;
      tokenSymbol: string;
      spenderAddress: string;
      spenderName: string | null;
      allowance: string;
      isUnlimited: boolean;
      isRisky: boolean;
      riskReason: string | null;
    }[] = [];

    const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    let hasRisky = false;
    let hasUnlimited = false;

    if (Array.isArray(data?.result)) {
      for (const approval of data.result) {
        const isUnlimited = approval.value === MAX_UINT256 || 
          (approval.value && BigInt(approval.value) > BigInt("1000000000000000000000000000"));
        
        const isRisky = approval.is_at_risk || approval.is_contract_verified === false;
        
        if (isUnlimited) hasUnlimited = true;
        if (isRisky) hasRisky = true;

        approvals.push({
          tokenAddress: approval.token?.address || "",
          tokenSymbol: approval.token?.symbol || "???",
          spenderAddress: approval.spender?.address || "",
          spenderName: approval.spender?.name || null,
          allowance: approval.value_formatted || approval.value || "0",
          isUnlimited,
          isRisky,
          riskReason: isRisky ? (approval.risk_reason || "Flagged as risky") : null,
        });
      }
    }

    let riskLevel: "none" | "some" | "high" = "none";
    if (hasRisky) {
      riskLevel = "high";
    } else if (hasUnlimited) {
      riskLevel = "some";
    }

    console.log(`[EVM API] Found ${approvals.length} approvals, risk level: ${riskLevel}`);
    return { approvals, riskLevel };
  } catch (error: any) {
    console.error(`[EVM API] Approvals fetch error:`, error.message);
    return { approvals: [], riskLevel: "none" };
  }
}

export function registerEvmRoutes(app: Express): void {
  app.get("/api/evm/:chainId/:address/tokens", async (req: Request, res: Response) => {
    const chainId = parseInt(req.params.chainId);
    const address = req.params.address;

    if (isNaN(chainId) || !VALID_CHAIN_IDS.includes(chainId)) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: `Invalid chainId. Supported: ${VALID_CHAIN_IDS.join(", ")}`,
        },
      });
    }

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: "Invalid address format",
        },
      });
    }

    const cacheKey = `${chainId}:${address.toLowerCase()}`;
    const cached = tokenBalanceCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < TOKEN_BALANCE_CACHE_TTL) {
      console.log(`[EVM API] Returning cached tokens for ${address}`);
      return res.json({ ok: true, tokens: cached.data, cached: true });
    }

    try {
      const tokens = await fetchMoralisTokenBalances(chainId, address);
      tokenBalanceCache.set(cacheKey, { data: tokens, timestamp: Date.now() });
      res.json({ ok: true, tokens, cached: false });
    } catch (error: any) {
      const errMsg: string = error.message || "";
      console.error("[EVM API] Token fetch error:", errMsg);

      if (errMsg === "MORALIS_NOT_CONFIGURED") {
        return res.status(503).json({
          ok: false,
          error: {
            code: "MORALIS_NOT_CONFIGURED",
            message: "Token discovery is not configured",
          },
        });
      }

      if (errMsg === "MORALIS_TIMEOUT") {
        return res.status(504).json({
          ok: false,
          error: {
            code: "MORALIS_TIMEOUT",
            message: "Token discovery timed out",
          },
        });
      }

      if (errMsg === "MORALIS_NETWORK_ERROR") {
        return res.status(502).json({
          ok: false,
          error: {
            code: "MORALIS_UPSTREAM_ERROR",
            message: "Token discovery provider unavailable",
          },
        });
      }

      const statusMatch = errMsg.match(/^MORALIS_STATUS:(\d+)$/);
      if (statusMatch) {
        const upstreamStatus = parseInt(statusMatch[1]);
        
        if (upstreamStatus === 429) {
          res.setHeader("Retry-After", "30");
          return res.status(429).json({
            ok: false,
            error: {
              code: "MORALIS_RATE_LIMITED",
              message: "Token discovery rate limited",
              retryAfterSec: 30,
              upstreamStatus: 429,
            },
          });
        }

        if (upstreamStatus >= 400 && upstreamStatus < 500) {
          return res.status(502).json({
            ok: false,
            error: {
              code: "MORALIS_UPSTREAM_ERROR",
              message: `Moralis error ${upstreamStatus}`,
              upstreamStatus,
            },
          });
        }

        return res.status(502).json({
          ok: false,
          error: {
            code: "MORALIS_UPSTREAM_ERROR",
            message: `Moralis error ${upstreamStatus}`,
            upstreamStatus,
          },
        });
      }

      return res.status(502).json({
        ok: false,
        error: {
          code: "MORALIS_UPSTREAM_ERROR",
          message: "Token discovery provider unavailable",
        },
      });
    }
  });

  app.get("/api/evm/:chainId/token-security/:tokenAddress", async (req: Request, res: Response) => {
    try {
      const chainId = parseInt(req.params.chainId);
      const tokenAddress = req.params.tokenAddress;

      if (!VALID_CHAIN_IDS.includes(chainId)) {
        return res.status(400).json({
          error: `Invalid chainId. Supported: ${VALID_CHAIN_IDS.join(", ")}`,
        });
      }

      if (!tokenAddress || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
        return res.status(400).json({ error: "Invalid token address" });
      }

      const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}`;
      const cached = tokenSecurityCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < TOKEN_SECURITY_CACHE_TTL) {
        console.log(`[EVM API] Returning cached security for ${tokenAddress}`);
        return res.json({ ...cached.data, cached: true });
      }

      const report = await fetchMoralisTokenSecurity(chainId, tokenAddress);
      
      tokenSecurityCache.set(cacheKey, { data: report, timestamp: Date.now() });

      res.json({ ...report, cached: false });
    } catch (error: any) {
      console.error("[EVM API] Security check error:", error.message);
      res.status(500).json({
        overallRisk: "UNKNOWN",
        verifiedFacts: [],
        warnings: [],
        unknowns: ["Security scan failed: " + error.message],
        sources: [],
        scannedAt: Date.now(),
      });
    }
  });

  app.get("/api/evm/:chainId/:address/approvals", async (req: Request, res: Response) => {
    try {
      const chainId = parseInt(req.params.chainId);
      const address = req.params.address;

      if (!VALID_CHAIN_IDS.includes(chainId)) {
        return res.status(400).json({
          error: `Invalid chainId. Supported: ${VALID_CHAIN_IDS.join(", ")}`,
        });
      }

      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return res.status(400).json({ error: "Invalid address" });
      }

      const result = await fetchMoralisApprovals(chainId, address);
      res.json(result);
    } catch (error: any) {
      console.error("[EVM API] Approvals fetch error:", error.message);
      res.status(500).json({ approvals: [], riskLevel: "none", error: error.message });
    }
  });

  console.log("[EVM API] Routes registered: /api/evm/:chainId/:address/tokens, /api/evm/:chainId/token-security/:tokenAddress, /api/evm/:chainId/:address/approvals");
}
