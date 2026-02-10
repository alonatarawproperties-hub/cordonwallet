import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { activityLogs } from "../../shared/schema";

/**
 * Classify API paths into human-readable action categories.
 */
function classifyAction(method: string, path: string): string {
  if (path.includes("/auth/")) {
    if (path.includes("exchange-code")) return "auth.exchange_code";
    if (path.includes("request-code")) return "auth.request_code";
    if (path.includes("logout")) return "auth.logout";
    if (path.includes("session")) return "auth.session_check";
    if (path.includes("mobile/start")) return "auth.mobile_start";
    if (path.includes("mobile/poll")) return "auth.mobile_poll";
    return "auth.other";
  }

  if (path.includes("/jupiter/quote")) return "swap.quote";
  if (path.includes("/jupiter/swap")) return "swap.build";
  if (path.includes("/jupiter/tokens")) return "swap.tokens";
  if (path.includes("/swap/")) return "swap.execute";

  if (path.includes("/solana/portfolio")) return "portfolio.solana";
  if (path.includes("/solana/balance")) return "balance.solana";
  if (path.includes("/solana/history")) return "history.solana";
  if (path.includes("/solana/prepare-sol-transfer")) return "send.sol";
  if (path.includes("/solana/prepare-spl-transfer")) return "send.spl";
  if (path.includes("/solana/send-signed")) return "send.broadcast";
  if (path.includes("/solana/send-raw")) return "send.broadcast_raw";
  if (path.includes("/solana/token-metadata")) return "token.metadata";
  if (path.includes("/solana/check-ata")) return "token.check_ata";
  if (path.includes("/solana/estimate-fee")) return "fee.estimate";
  if (path.includes("/solana/token-accounts")) return "token.accounts";
  if (path.includes("/solana/prepare-revoke")) return "security.revoke";
  if (path.includes("/solana/health")) return "health.check";

  if (path.includes("/transactions/")) return "history.evm";
  if (path.includes("/approvals/")) return "security.approvals";
  if (path.includes("/evm/")) return "evm.query";

  if (path.includes("/prices")) return "price.current";
  if (path.includes("/market-chart")) return "price.chart";
  if (path.includes("/historical-price")) return "price.historical";
  if (path.includes("/dexscreener/")) return "price.dexscreener";

  if (path.includes("/token-info")) return "token.info";
  if (path.includes("/token-safety")) {
    return method === "PUT" ? "safety.store" : "safety.check";
  }

  if (path.includes("/enrich-transactions")) return "history.enrich";

  return `${method.toLowerCase()}.other`;
}

/**
 * Sanitize request body — remove sensitive fields, truncate large values.
 */
function sanitizeBody(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== "object") return undefined;

  const sensitive = new Set([
    "privateKey", "secretKey", "seedPhrase", "mnemonic",
    "password", "pin", "secret", "signatureBase64",
    "transactionBase64", "swapTransaction",
    "codeVerifier", "idToken", "accessToken", "googleToken",
  ]);

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (sensitive.has(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.length > 200) {
      sanitized[key] = value.slice(0, 200) + "...[truncated]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = "[object]";
    } else {
      sanitized[key] = value;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * Extract user identity from request (JWT, body, query, or path params).
 */
function extractUser(req: Request): { userId?: string; email?: string } {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const token = authHeader.slice(7);
      const [, body] = token.split(".");
      const payload = JSON.parse(Buffer.from(body, "base64url").toString());
      return { userId: payload.sub, email: payload.email };
    } catch {
      // ignore invalid JWT
    }
  }

  if (req.body?.userPublicKey) {
    return { userId: req.body.userPublicKey };
  }

  if (req.query.address) {
    return { userId: req.query.address as string };
  }

  if (req.params?.address) {
    return { userId: req.params.address };
  }

  if (req.params?.owner) {
    return { userId: req.params.owner };
  }

  return {};
}

function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") return xff.split(",")[0].trim();
  if (Array.isArray(xff)) return xff[0]?.split(",")[0].trim() || "unknown";
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Express middleware that logs every /api/* request to the activity_logs table.
 * Logging is fire-and-forget — failures never block the response.
 */
export function activityLoggerMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api")) return next();

    // Skip noisy health checks
    if (req.path === "/api/solana/health" || req.path === "/api/health") {
      return next();
    }

    const start = Date.now();

    res.on("finish", () => {
      const { userId, email } = extractUser(req);
      const action = classifyAction(req.method, req.path);
      const ip = getClientIp(req);
      const userAgent = (req.headers["user-agent"] || "").slice(0, 512);
      const durationMs = Date.now() - start;
      const details = sanitizeBody(req.body);

      db.insert(activityLogs)
        .values({
          userId: userId?.slice(0, 128) || null,
          email: email?.slice(0, 256) || null,
          method: req.method.slice(0, 10),
          path: req.path.slice(0, 2048),
          statusCode: res.statusCode,
          action,
          details: details || null,
          ip: ip.slice(0, 64),
          userAgent,
          durationMs,
          createdAt: Date.now(),
        })
        .catch((err) => {
          console.error("[ActivityLogger] Failed to log:", err.message);
        });
    });

    next();
  };
}
