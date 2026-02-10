import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { db } from "./db";
import { activityLogs } from "../shared/schema";
import { desc, and, gte, lte, like, sql, count, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Admin JWT helpers
// ---------------------------------------------------------------------------

function getSessionSecret(): string {
  return process.env.SESSION_SECRET || "";
}

function generateAdminToken(): string {
  const secret = getSessionSecret();
  const payload = {
    role: "admin",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyAdminToken(token: string): boolean {
  try {
    const secret = getSessionSecret();
    if (!secret) return false;

    const [header, body, signature] = token.split(".");
    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(`${header}.${body}`)
      .digest("base64url");

    const sigBuf = Buffer.from(signature || "", "base64url");
    const expBuf = Buffer.from(expectedSig, "base64url");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return false;
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return false;
    if (payload.role !== "admin") return false;

    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Admin auth middleware
// ---------------------------------------------------------------------------

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.cordon_admin;
  if (!token || !verifyAdminToken(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ---------------------------------------------------------------------------
// Login rate limiter (prevent brute force on admin secret)
// ---------------------------------------------------------------------------

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.headers["x-forwarded-for"]?.toString().split(",")[0] || "unknown";
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return next();
  }

  if (entry.count >= 5) {
    return res.status(429).json({ error: "Too many attempts. Try again in 1 minute." });
  }

  entry.count++;
  next();
}

// ---------------------------------------------------------------------------
// Ensure the activity_logs table exists (called once at startup)
// ---------------------------------------------------------------------------

async function ensureActivityLogsTable() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(128),
        email VARCHAR(256),
        method VARCHAR(10) NOT NULL,
        path TEXT NOT NULL,
        status_code INTEGER,
        action VARCHAR(64),
        details JSONB,
        ip VARCHAR(64),
        user_agent TEXT,
        duration_ms INTEGER,
        created_at BIGINT NOT NULL
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id)`);
    console.log("[Admin] activity_logs table ensured");
  } catch (err: any) {
    console.error("[Admin] Failed to ensure activity_logs table:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Register all /admin routes
// ---------------------------------------------------------------------------

export function registerAdminRoutes(app: Express) {
  ensureActivityLogsTable();

  // ── Serve the admin dashboard HTML ──────────────────────────────────
  app.get("/admin", (_req: Request, res: Response) => {
    const templatePath = path.resolve(process.cwd(), "server", "templates", "admin-dashboard.html");
    try {
      const html = fs.readFileSync(templatePath, "utf-8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(html);
    } catch {
      res.status(500).send("Admin dashboard not found");
    }
  });

  // ── Login ───────────────────────────────────────────────────────────
  app.post("/admin/api/login", loginRateLimit, (req: Request, res: Response) => {
    const { secret } = req.body;
    const adminSecret = process.env.ADMIN_SECRET;

    if (!adminSecret) {
      return res.status(503).json({
        error: "Admin access not configured. Set the ADMIN_SECRET environment variable.",
      });
    }

    const a = Buffer.from(String(secret || ""));
    const b = Buffer.from(adminSecret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "Invalid admin secret" });
    }

    const token = generateAdminToken();

    res.cookie("cordon_admin", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 86_400_000,
    });

    res.json({ success: true });
  });

  // ── Logout ──────────────────────────────────────────────────────────
  app.post("/admin/api/logout", (_req: Request, res: Response) => {
    res.clearCookie("cordon_admin", { path: "/" });
    res.json({ success: true });
  });

  // ── Auth check ──────────────────────────────────────────────────────
  app.get("/admin/api/auth-check", (req: Request, res: Response) => {
    const token = req.cookies?.cordon_admin;
    res.json({ authenticated: !!token && verifyAdminToken(token) });
  });

  // ── Activity logs (paginated, filterable) ───────────────────────────
  app.get("/admin/api/logs", requireAdmin, async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
      const offset = (page - 1) * limit;

      const conditions: ReturnType<typeof eq>[] = [];

      if (req.query.action) {
        conditions.push(like(activityLogs.action, `${req.query.action}%`));
      }
      if (req.query.userId) {
        conditions.push(like(activityLogs.userId, `%${req.query.userId}%`));
      }
      if (req.query.email) {
        conditions.push(like(activityLogs.email, `%${req.query.email}%`));
      }
      if (req.query.method) {
        conditions.push(eq(activityLogs.method, (req.query.method as string).toUpperCase()));
      }
      if (req.query.statusCode) {
        conditions.push(eq(activityLogs.statusCode, parseInt(req.query.statusCode as string)));
      }
      if (req.query.from) {
        conditions.push(gte(activityLogs.createdAt, parseInt(req.query.from as string)));
      }
      if (req.query.to) {
        conditions.push(lte(activityLogs.createdAt, parseInt(req.query.to as string)));
      }
      if (req.query.search) {
        const s = `%${req.query.search}%`;
        conditions.push(
          sql`(${activityLogs.path} ILIKE ${s} OR ${activityLogs.userId} ILIKE ${s} OR ${activityLogs.email} ILIKE ${s} OR ${activityLogs.action} ILIKE ${s} OR ${activityLogs.ip} ILIKE ${s})` as any,
        );
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [logs, totalResult] = await Promise.all([
        db
          .select()
          .from(activityLogs)
          .where(where)
          .orderBy(desc(activityLogs.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ count: count() }).from(activityLogs).where(where),
      ]);

      const total = Number(totalResult[0]?.count ?? 0);

      res.json({
        logs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (err: any) {
      console.error("[Admin] logs error:", err.message);
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });

  // ── Dashboard stats ─────────────────────────────────────────────────
  app.get("/admin/api/stats", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      const oneDayAgo = now - 86_400_000;
      const oneHourAgo = now - 3_600_000;

      const [totalR, todayR, hourR, errorsR, uniqueR, topActionsR, topUsersR] =
        await Promise.all([
          db.select({ count: count() }).from(activityLogs),
          db.select({ count: count() }).from(activityLogs).where(gte(activityLogs.createdAt, oneDayAgo)),
          db.select({ count: count() }).from(activityLogs).where(gte(activityLogs.createdAt, oneHourAgo)),
          db
            .select({ count: count() })
            .from(activityLogs)
            .where(and(gte(activityLogs.createdAt, oneDayAgo), gte(activityLogs.statusCode, 400))),
          db.execute(sql`
            SELECT COUNT(DISTINCT user_id) AS count
            FROM activity_logs
            WHERE created_at >= ${oneDayAgo} AND user_id IS NOT NULL
          `),
          db.execute(sql`
            SELECT action, COUNT(*)::int AS count
            FROM activity_logs
            WHERE created_at >= ${oneDayAgo} AND action IS NOT NULL
            GROUP BY action ORDER BY count DESC LIMIT 10
          `),
          db.execute(sql`
            SELECT user_id, COUNT(*)::int AS count
            FROM activity_logs
            WHERE created_at >= ${oneDayAgo} AND user_id IS NOT NULL
            GROUP BY user_id ORDER BY count DESC LIMIT 10
          `),
        ]);

      res.json({
        total: Number(totalR[0]?.count ?? 0),
        today: Number(todayR[0]?.count ?? 0),
        lastHour: Number(hourR[0]?.count ?? 0),
        errorsToday: Number(errorsR[0]?.count ?? 0),
        uniqueUsersToday: Number((uniqueR as any).rows?.[0]?.count ?? 0),
        topActions: (topActionsR as any).rows ?? [],
        topUsers: (topUsersR as any).rows ?? [],
      });
    } catch (err: any) {
      console.error("[Admin] stats error:", err.message);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  console.log("[Admin] Routes registered at /admin");
}
