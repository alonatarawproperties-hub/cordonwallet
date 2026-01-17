import { Router, Request, Response } from "express";
import dns from "dns";
import net from "net";
import { jupiterQuotePing } from "./jupiterClient";

export const diagRouter = Router();

const JUPITER_HOST = "quote-api.jup.ag";

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
  const results: {
    ts: number;
    dnsLookup: DnsResult;
    tcpConnect: TcpResult;
    httpsFetch: Awaited<ReturnType<typeof jupiterQuotePing>>;
    summary: {
      dnsOk: boolean;
      tcpOk: boolean;
      httpsOk: boolean;
      likelyIssue: string;
    };
  } = {
    ts: Date.now(),
    dnsLookup: { ok: false, host: JUPITER_HOST, latencyMs: 0 },
    tcpConnect: { ok: false, host: JUPITER_HOST, port: 443, latencyMs: 0 },
    httpsFetch: { ok: false, latencyMs: 0, baseUrlUsed: "" },
    summary: { dnsOk: false, tcpOk: false, httpsOk: false, likelyIssue: "" },
  };

  results.dnsLookup = await dnsLookup(JUPITER_HOST);
  results.summary.dnsOk = results.dnsLookup.ok;

  if (results.dnsLookup.ok && results.dnsLookup.addresses?.[0]) {
    const ip = results.dnsLookup.addresses[0].address;
    results.tcpConnect = await tcpConnect(ip, 443, 3000);
    results.summary.tcpOk = results.tcpConnect.ok;
  } else {
    results.tcpConnect = {
      ok: false,
      host: JUPITER_HOST,
      port: 443,
      latencyMs: 0,
      error: "Skipped: DNS lookup failed",
    };
  }

  results.httpsFetch = await jupiterQuotePing();
  results.summary.httpsOk = results.httpsFetch.ok;

  if (!results.summary.dnsOk) {
    results.summary.likelyIssue = "DNS resolution failed - host may be blocking DNS or network egress is restricted";
  } else if (!results.summary.tcpOk) {
    results.summary.likelyIssue = "TCP connection to port 443 failed - firewall may be blocking outbound HTTPS";
  } else if (!results.summary.httpsOk) {
    results.summary.likelyIssue = "HTTPS request failed - TLS handshake issue or Jupiter API error";
  } else {
    results.summary.likelyIssue = "None - all connectivity checks passed";
  }

  res.json(results);
});

diagRouter.get("/dns", async (req: Request, res: Response) => {
  const host = req.query.host as string;
  
  if (!host || typeof host !== "string") {
    return res.status(400).json({ ok: false, error: "Missing ?host= parameter" });
  }

  const sanitizedHost = host.replace(/[^a-zA-Z0-9.-]/g, "").slice(0, 253);
  
  if (sanitizedHost.length === 0) {
    return res.status(400).json({ ok: false, error: "Invalid host" });
  }

  const result = await dnsLookup(sanitizedHost);
  res.json(result);
});

diagRouter.get("/tcp", async (req: Request, res: Response) => {
  const host = req.query.host as string;
  const port = parseInt(req.query.port as string) || 443;

  if (!host || typeof host !== "string") {
    return res.status(400).json({ ok: false, error: "Missing ?host= parameter" });
  }

  const sanitizedHost = host.replace(/[^a-zA-Z0-9.-]/g, "").slice(0, 253);
  
  if (sanitizedHost.length === 0 || port < 1 || port > 65535) {
    return res.status(400).json({ ok: false, error: "Invalid host or port" });
  }

  const result = await tcpConnect(sanitizedHost, port, 5000);
  res.json(result);
});

diagRouter.get("/env", async (_req: Request, res: Response) => {
  res.json({
    ts: Date.now(),
    JUPITER_BASE_URL: process.env.JUPITER_BASE_URL || "(default: https://quote-api.jup.ag)",
    JUPITER_FALLBACK_URLS: process.env.JUPITER_FALLBACK_URLS || "(not set)",
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL ? "configured" : "missing",
    NODE_ENV: process.env.NODE_ENV || "development",
  });
});
