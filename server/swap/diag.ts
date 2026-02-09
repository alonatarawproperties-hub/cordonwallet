import { Router, Request, Response } from "express";
import dns from "dns";
import net from "net";
import { jupiterQuotePing, getConfiguredBaseUrls, hasApiKey } from "./jupiterClient";

export const diagRouter = Router();

const JUPITER_LITE_HOST = "lite-api.jup.ag";
const JUPITER_PRO_HOST = "api.jup.ag";

interface DnsResult {
  ok: boolean;
  host: string;
  addresses?: dns.LookupAddress[];
  latencyMs: number;
  error?: string;
}

interface TcpResult {
  ok: boolean;
  host: string;
  port: number;
  latencyMs: number;
  error?: string;
}

async function dnsLookup(host: string): Promise<DnsResult> {
  const start = Date.now();
  try {
    const addresses = await dns.promises.lookup(host, { all: true });
    return {
      ok: true,
      host,
      addresses,
      latencyMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      ok: false,
      host,
      latencyMs: Date.now() - start,
      error: `${err.code || err.name}: ${err.message}`,
    };
  }
}

async function tcpConnect(host: string, port: number, timeoutMs: number = 3000): Promise<TcpResult> {
  const start = Date.now();
  
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      const latencyMs = Date.now() - start;
      cleanup();
      resolve({ ok: true, host, port, latencyMs });
    });

    socket.on("timeout", () => {
      const latencyMs = Date.now() - start;
      cleanup();
      resolve({ ok: false, host, port, latencyMs, error: "Connection timeout" });
    });

    socket.on("error", (err: any) => {
      const latencyMs = Date.now() - start;
      cleanup();
      resolve({
        ok: false,
        host,
        port,
        latencyMs,
        error: `${err.code || err.name}: ${err.message}`,
      });
    });

    socket.connect(port, host);
  });
}

diagRouter.get("/jupiter", async (_req: Request, res: Response) => {
  const baseUrls = getConfiguredBaseUrls();
  const primaryHost = JUPITER_LITE_HOST;

  const results: {
    ts: number;
    configuredBaseUrls: string[];
    hasApiKey: boolean;
    dnsLookup: { lite: DnsResult; pro: DnsResult };
    tcpConnect: { lite: TcpResult; pro: TcpResult };
    httpsFetch: Awaited<ReturnType<typeof jupiterQuotePing>>;
    summary: {
      liteDnsOk: boolean;
      proDnsOk: boolean;
      httpsOk: boolean;
      likelyIssue: string;
    };
  } = {
    ts: Date.now(),
    configuredBaseUrls: baseUrls,
    hasApiKey: hasApiKey(),
    dnsLookup: {
      lite: { ok: false, host: JUPITER_LITE_HOST, latencyMs: 0 },
      pro: { ok: false, host: JUPITER_PRO_HOST, latencyMs: 0 },
    },
    tcpConnect: {
      lite: { ok: false, host: JUPITER_LITE_HOST, port: 443, latencyMs: 0 },
      pro: { ok: false, host: JUPITER_PRO_HOST, port: 443, latencyMs: 0 },
    },
    httpsFetch: { ok: false, latencyMs: 0, baseUrlUsed: "" },
    summary: { liteDnsOk: false, proDnsOk: false, httpsOk: false, likelyIssue: "" },
  };

  const [liteDns, proDns] = await Promise.all([
    dnsLookup(JUPITER_LITE_HOST),
    dnsLookup(JUPITER_PRO_HOST),
  ]);

  results.dnsLookup.lite = liteDns;
  results.dnsLookup.pro = proDns;
  results.summary.liteDnsOk = liteDns.ok;
  results.summary.proDnsOk = proDns.ok;

  const tcpPromises: Promise<TcpResult>[] = [];
  if (liteDns.ok && liteDns.addresses?.[0]) {
    tcpPromises.push(tcpConnect(liteDns.addresses[0].address, 443, 3000));
  } else {
    tcpPromises.push(Promise.resolve({
      ok: false, host: JUPITER_LITE_HOST, port: 443, latencyMs: 0, error: "Skipped: DNS failed",
    }));
  }
  if (proDns.ok && proDns.addresses?.[0]) {
    tcpPromises.push(tcpConnect(proDns.addresses[0].address, 443, 3000));
  } else {
    tcpPromises.push(Promise.resolve({
      ok: false, host: JUPITER_PRO_HOST, port: 443, latencyMs: 0, error: "Skipped: DNS failed",
    }));
  }

  const [liteTcp, proTcp] = await Promise.all(tcpPromises);
  results.tcpConnect.lite = liteTcp;
  results.tcpConnect.pro = proTcp;

  results.httpsFetch = await jupiterQuotePing();
  results.summary.httpsOk = results.httpsFetch.ok;

  if (!results.summary.liteDnsOk && !results.summary.proDnsOk) {
    results.summary.likelyIssue = "DNS resolution failed for all Jupiter hosts - network egress may be restricted";
  } else if (!results.summary.httpsOk) {
    results.summary.likelyIssue = "HTTPS request failed despite DNS success - check TLS or firewall";
  } else {
    results.summary.likelyIssue = "None - connectivity OK";
  }

  res.json(results);
});

// Security: Arbitrary DNS/TCP endpoints removed — they allow SSRF and internal
// network reconnaissance.  The /jupiter diagnostic above is safe because it only
// contacts hardcoded Jupiter hosts.

diagRouter.get("/dns", (_req: Request, res: Response) => {
  res.status(403).json({ error: "Endpoint disabled for security" });
});

diagRouter.get("/tcp", (_req: Request, res: Response) => {
  res.status(403).json({ error: "Endpoint disabled for security" });
});

diagRouter.get("/env", (_req: Request, res: Response) => {
  // Only expose non-sensitive runtime info
  res.json({
    ts: Date.now(),
    NODE_ENV: process.env.NODE_ENV || "development",
  });
});
