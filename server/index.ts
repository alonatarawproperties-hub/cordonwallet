import express from "express";
import type { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { registerCordonAuthRoutes } from "./cordon-auth";
import { swapRouter } from "./swap";
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

    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }

    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }

    const origin = req.header("origin");

    if (origin && origins.has(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(cookieParser());
  
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));
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
  const metadataPath = path.resolve(process.cwd(), "static-build", "metadata.json");
  const appJsonPath = path.resolve(process.cwd(), "app.json");

  if (!fs.existsSync(metadataPath)) {
    return res.status(404).json({ error: `Static build not found. Run expo export first.` });
  }

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    const expo = appJson.expo || {};

    const platformData = metadata.fileMetadata[platform];
    if (!platformData) {
      return res.status(404).json({ error: `No bundle for platform: ${platform}` });
    }

    // Build the host URL
    const forwardedProto = req.header("x-forwarded-proto") || req.protocol || "https";
    const forwardedHost = req.header("x-forwarded-host") || req.get("host");
    const baseUrl = `${forwardedProto}://${forwardedHost}`;

    // Build Expo manifest - sdkVersion is CRITICAL for Expo Go compatibility
    const sdkVersion = "54.0.0";
    const runtimeVersion = expo.runtimeVersion || `exposdk:${sdkVersion}`;
    
    const manifest = {
      id: `@anonymous/${expo.slug || "app"}`,
      createdAt: new Date().toISOString(),
      runtimeVersion: runtimeVersion,
      sdkVersion: sdkVersion,
      launchAsset: {
        key: "bundle",
        contentType: "application/javascript",
        url: `${baseUrl}/${platformData.bundle}`,
      },
      assets: (platformData.assets || []).map((asset: { path: string; ext: string }) => ({
        key: asset.path.split("/").pop(),
        contentType: asset.ext === "ttf" ? "font/ttf" : `image/${asset.ext}`,
        url: `${baseUrl}/${asset.path}`,
      })),
      metadata: {},
      extra: {
        expoClient: {
          name: expo.name || "App",
          slug: expo.slug || "app",
          version: expo.version || "1.0.0",
          orientation: expo.orientation || "portrait",
          icon: expo.icon,
          scheme: expo.scheme,
          userInterfaceStyle: expo.userInterfaceStyle || "automatic",
          ios: expo.ios || {},
          android: expo.android || {},
          web: expo.web || {},
          extra: expo.extra || {},
        },
      },
    };

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
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  
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
    const message = error.message || "Internal Server Error";

    res.status(status).json({ message });

    throw err;
  });
}

(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  // Auth routes must be registered BEFORE static file serving
  // to prevent Expo SPA from intercepting /auth/* paths
  registerCordonAuthRoutes(app);
  
  // Swap API routes
  app.use("/api/swap", swapRouter);
  
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
