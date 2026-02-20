import express from "express";
import type { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import { registerRoutes } from "./routes";
import { registerCordonAuthRoutes } from "./cordon-auth";

import { swapRouter } from "./swap";
import { registerAdminRoutes } from "./admin";
import { activityLoggerMiddleware } from "./middleware/activityLogger";
import * as fs from "fs";
import * as path from "path";

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    // Production domain
    origins.add("https://app.cordonwallet.com");

    // Local development
    if (process.env.NODE_ENV !== "production") {
      origins.add("http://localhost:3000");
      origins.add("http://localhost:5000");
      origins.add("http://localhost:8081");
    }

    const origin = req.header("origin");

    if (origin && origins.has(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

/**
 * Security headers middleware.
 * Sets defensive HTTP headers to mitigate common web attacks.
 */
function setupSecurityHeaders(app: express.Application) {
  app.use((_req, res, next) => {
    // Prevent clickjacking
    res.setHeader("X-Frame-Options", "DENY");
    // Prevent MIME-type sniffing
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Disable browser-side XSS filter (modern CSP is preferred)
    res.setHeader("X-XSS-Protection", "0");
    // Only send origin in Referer header
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // Restrict what the page can load
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none';"
    );
    // Opt out of FLoC / Topics
    res.setHeader("Permissions-Policy", "interest-cohort=()");
    // HSTS — tell browsers to always use HTTPS (1 year)
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
}

/**
 * API key authentication middleware.
 * Requires X-API-Key header on all /api/* routes.
 * Auth callback routes (/auth/*) are excluded since they're browser-based OAuth flows.
 * Health check is excluded so uptime monitors still work.
 */
function setupApiKeyAuth(app: express.Application) {
  const apiKey = process.env.CORDON_API_KEY;

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      // In production, refuse to start without an API key — all /api/* routes
      // would be wide open to the internet otherwise.
      log("[Security] FATAL: CORDON_API_KEY is not set. Refusing to start in production.");
      process.exit(1);
    } else {
      log("[Security] CORDON_API_KEY not set — API key auth disabled in development");
    }
    return;
  }

  log("[Security] API key auth enabled for /api/* routes");

  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    // Allow health check without auth (uptime monitors)
    if (req.path === "/solana/health" || req.path === "/health") {
      return next();
    }

    // Allow auth routes without API key — these are browser-based OAuth
    // redirect flows and mobile poll endpoints that can't send custom headers
    if (req.path.startsWith("/auth/")) {
      return next();
    }

    const providedKey = req.header("X-API-Key");

    if (!providedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Timing-safe comparison to prevent key extraction via timing side-channel
    const a = Buffer.from(providedKey);
    const b = Buffer.from(apiKey);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(cookieParser());
  
  app.use(
    express.json({
      limit: "1mb", // Prevent large-payload DoS
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function getTunnelUrl(): string | null {
  try {
    const tunnelUrlPath = "/tmp/expo-tunnel-url.txt";
    if (fs.existsSync(tunnelUrlPath)) {
      const url = fs.readFileSync(tunnelUrlPath, "utf-8").trim();
      return url || null;
    }
    return null;
  } catch {
    return null;
  }
}

function serveExpoManifest(platform: string, req: Request, res: Response) {
  const manifestPath = path.resolve(process.cwd(), "static-build", platform, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Static build not found for ${platform}. Run build script first.` });
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    
    res.setHeader("expo-protocol-version", "1");
    res.setHeader("expo-sfv-version", "0");
    res.setHeader("content-type", "application/json");
    res.send(JSON.stringify(manifest));
  } catch (err) {
    log("Error serving manifest:", err);
    return res.status(500).json({ error: "Failed to generate manifest" });
  }
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");

  // Security: validate host to prevent host-header injection
  const hostStr = String(host || "");
  if (!/^[a-zA-Z0-9._:-]+$/.test(hostStr)) {
    res.status(400).send("Bad Request");
    return;
  }

  const baseUrl = `${protocol}://${hostStr}`;
  const expsUrl = `${hostStr}`;
  
  // Get tunnel URL if available (from Expo's ngrok tunnel)
  const tunnelUrl = getTunnelUrl();

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  log(`tunnelUrl`, tunnelUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName)
    .replace(/TUNNEL_URL_PLACEHOLDER/g, tunnelUrl || "")
    .replace(/TUNNEL_URL_AVAILABLE/g, tunnelUrl ? "true" : "false");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  log("Serving static Expo files with dynamic manifest routing");

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }

    // Check header first, then query param (Expo Go uses ?platform=ios)
    const platform = req.header("expo-platform") || (req.query.platform as string);
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, req, res);
    }

    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      });
    }

    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;

    // Security: never leak internal error messages to clients
    const safeMessage = status < 500 ? (error.message || "Bad Request") : "Internal Server Error";

    // Log the full error server-side for debugging
    console.error("[Error]", error.message || err);

    res.status(status).json({ message: safeMessage });
  });
}

(async () => {
  setupSecurityHeaders(app);
  setupCors(app);
  setupBodyParsing(app);
  setupApiKeyAuth(app);
  setupRequestLogging(app);

  // Activity logging — captures every /api/* request to the database
  app.use(activityLoggerMiddleware());

  // Auth routes must be registered BEFORE static file serving
  // to prevent Expo SPA from intercepting /auth/* paths
  registerCordonAuthRoutes(app);

  // Swap API routes
  app.use("/api/swap", swapRouter);
  log("[Swap] Router mounted at /api/swap");

  // Admin panel — must be registered BEFORE Expo/landing page config
  registerAdminRoutes(app);

  configureExpoAndLanding(app);

  const server = await registerRoutes(app);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`express server serving on port ${port}`);
    },
  );
})();
