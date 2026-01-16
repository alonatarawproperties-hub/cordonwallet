import { Router, Request, Response } from "express";
import { 
  QuoteParamsSchema, 
  BuildJupiterBodySchema, 
  BuildPumpBodySchema, 
  SendBodySchema 
} from "./types";
import { getQuote, buildSwapTransaction } from "./jupiter";
import { buildPumpTransaction, isPumpToken } from "./pump";
import { broadcastTransaction, getTransactionStatus } from "./broadcast";
import { searchTokens, getToken, resolveToken, initTokenList } from "./tokenlist";
import { getRouteQuote, getPumpMeta } from "./route";

export const swapRouter = Router();

initTokenList();

// Health check for swap service
swapRouter.get("/health", async (_req: Request, res: Response) => {
  try {
    // Test Jupiter API connectivity
    const jupiterOk = await fetch("https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000&slippageBps=50", {
      signal: AbortSignal.timeout(5000)
    }).then(r => r.ok).catch(() => false);

    res.json({
      ok: true,
      timestamp: Date.now(),
      services: {
        jupiter: jupiterOk ? "ok" : "unreachable",
      }
    });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      timestamp: Date.now(),
      error: err.message
    });
  }
});

const tokenLookupRateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function checkTokenRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = tokenLookupRateLimit.get(ip);
  
  if (!entry || now >= entry.resetAt) {
    tokenLookupRateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of tokenLookupRateLimit.entries()) {
    if (now >= entry.resetAt) {
      tokenLookupRateLimit.delete(ip);
    }
  }
}, 60000);

swapRouter.get("/solana/route-quote", async (req: Request, res: Response) => {
  try {
    const parsed = QuoteParamsSchema.safeParse(req.query);
    
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "Invalid parameters",
        details: parsed.error.flatten(),
      });
    }
    
    const result = await getRouteQuote({
      inputMint: parsed.data.inputMint,
      outputMint: parsed.data.outputMint,
      amount: parsed.data.amount,
      slippageBps: parsed.data.slippageBps,
    });
    
    if (result.ok) {
      res.json(result);
    } else {
      const status = result.reason === "NO_ROUTE" ? 404 : 502;
      res.status(status).json(result);
    }
  } catch (err: any) {
    console.error("[Swap API] Route quote failed:", err);
    res.status(500).json({
      ok: false,
      route: "none",
      reason: "INTERNAL_ERROR",
      message: err.message,
    });
  }
});

swapRouter.get("/solana/pump-meta/:mint", async (req: Request, res: Response) => {
  try {
    const { mint } = req.params;
    const meta = await getPumpMeta(mint);
    res.json({ ok: true, ...meta });
  } catch (err: any) {
    console.error("[Swap API] Pump meta failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

swapRouter.get("/solana/tokens", async (req: Request, res: Response) => {
  try {
    const query = (req.query.query as string) || "";
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 250);
    
    const tokens = await searchTokens(query, limit);
    res.json({ ok: true, tokens });
  } catch (err: any) {
    console.error("[Swap API] Token search failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

swapRouter.get("/solana/token/:mint", async (req: Request, res: Response) => {
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  
  if (!checkTokenRateLimit(clientIp)) {
    return res.status(429).json({ ok: false, error: "rate_limited" });
  }
  
  try {
    const { mint } = req.params;
    const result = await resolveToken(mint);
    
    if ("error" in result) {
      return res.status(result.code).json({ 
        ok: false, 
        error: "Token lookup failed", 
        details: result.error 
      });
    }
    
    res.json({ ok: true, ...result.token });
  } catch (err: any) {
    console.error("[Swap API] Token lookup failed:", err);
    res.status(500).json({ ok: false, error: "Token lookup failed", details: err.message });
  }
});

swapRouter.get("/solana/quote", async (req: Request, res: Response) => {
  try {
    const parsed = QuoteParamsSchema.safeParse(req.query);
    
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "Invalid parameters",
        details: parsed.error.flatten(),
      });
    }
    
    const result = await getQuote(parsed.data);
    
    if (result.ok) {
      res.json(result);
    } else {
      const status = result.code === "NO_ROUTE" ? 404 : 
                     result.code === "TIMEOUT" ? 504 : 502;
      res.status(status).json(result);
    }
  } catch (err: any) {
    console.error("[Swap API] Quote failed:", err);
    res.status(500).json({
      ok: false,
      code: "UPSTREAM",
      message: err.message,
    });
  }
});

swapRouter.post("/solana/build", async (req: Request, res: Response) => {
  try {
    const parsed = BuildJupiterBodySchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    
    if (!parsed.data.quote) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "Missing quote in body",
      });
    }
    
    const result = await buildSwapTransaction({
      ...parsed.data,
      quote: parsed.data.quote,
    });
    
    if (result.ok) {
      res.json(result);
    } else {
      res.status(502).json(result);
    }
  } catch (err: any) {
    console.error("[Swap API] Build failed:", err);
    res.status(500).json({
      ok: false,
      code: "BUILD_FAILED",
      message: err.message,
    });
  }
});

swapRouter.post("/solana/pump/build", async (req: Request, res: Response) => {
  try {
    const parsed = BuildPumpBodySchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: "BAD_REQUEST",
        message: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    
    const result = await buildPumpTransaction(parsed.data);
    
    if (result.ok) {
      res.json(result);
    } else {
      res.status(502).json(result);
    }
  } catch (err: any) {
    console.error("[Swap API] Pump build failed:", err);
    res.status(500).json({
      ok: false,
      code: "PUMP_UNAVAILABLE",
      message: err.message,
    });
  }
});

swapRouter.post("/solana/send", async (req: Request, res: Response) => {
  try {
    const parsed = SendBodySchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_TX",
        message: "Invalid body",
        details: parsed.error.flatten(),
      });
    }
    
    const result = await broadcastTransaction(parsed.data);
    
    if (result.ok) {
      res.json(result);
    } else {
      res.status(502).json(result);
    }
  } catch (err: any) {
    console.error("[Swap API] Send failed:", err);
    res.status(500).json({
      ok: false,
      code: "SEND_FAILED",
      message: err.message,
    });
  }
});

swapRouter.get("/solana/status", async (req: Request, res: Response) => {
  try {
    const sig = req.query.sig as string;
    
    if (!sig) {
      return res.status(400).json({ ok: false, error: "Missing signature" });
    }
    
    const status = await getTransactionStatus(sig);
    res.json({ ok: true, ...status });
  } catch (err: any) {
    console.error("[Swap API] Status check failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

swapRouter.get("/solana/is-pump", async (req: Request, res: Response) => {
  const mint = req.query.mint as string;
  
  if (!mint) {
    return res.status(400).json({ ok: false, error: "Missing mint" });
  }
  
  res.json({ ok: true, isPump: isPumpToken(mint) });
});

export default swapRouter;
