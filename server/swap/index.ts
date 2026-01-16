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
import { searchTokens, getToken, initTokenList } from "./tokenlist";

export const swapRouter = Router();

initTokenList();

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
  try {
    const { mint } = req.params;
    const token = await getToken(mint);
    
    if (!token) {
      return res.status(404).json({ ok: false, error: "Token not found" });
    }
    
    res.json({ ok: true, token });
  } catch (err: any) {
    console.error("[Swap API] Token lookup failed:", err);
    res.status(500).json({ ok: false, error: err.message });
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
