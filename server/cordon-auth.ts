import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { db } from "./db";
import { mobileAuthSessions as mobileAuthSessionsTable, cordonSessions } from "../shared/schema";
import { eq, and, lt } from "drizzle-orm";

interface AuthCode {
  code: string;
  userId: string;
  email: string;
  name: string;
  googleAccessToken: string;
  createdAt: number;
  used: boolean;
}

const authCodes = new Map<string, AuthCode>();
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const MOBILE_SESSION_EXPIRY_MS = 10 * 60 * 1000;

async function createMobileSession(sessionId: string, codeVerifier: string) {
  await db.insert(mobileAuthSessionsTable).values({
    sessionId,
    status: "pending",
    codeVerifier,
    createdAt: Date.now(),
  });
}

async function getMobileSession(sessionId: string) {
  const result = await db.select().from(mobileAuthSessionsTable)
    .where(eq(mobileAuthSessionsTable.sessionId, sessionId))
    .limit(1);
  return result[0] || null;
}

async function updateMobileSession(sessionId: string, data: {
  status?: string;
  code?: string;
  idToken?: string;
  accessToken?: string;
  error?: string;
}) {
  await db.update(mobileAuthSessionsTable)
    .set(data)
    .where(eq(mobileAuthSessionsTable.sessionId, sessionId));
}

async function deleteMobileSession(sessionId: string) {
  await db.delete(mobileAuthSessionsTable)
    .where(eq(mobileAuthSessionsTable.sessionId, sessionId));
}

async function cleanupExpiredMobileSessions() {
  const expiryTime = Date.now() - MOBILE_SESSION_EXPIRY_MS;
  await db.delete(mobileAuthSessionsTable)
    .where(lt(mobileAuthSessionsTable.createdAt, expiryTime));
}

// Security: HTML escape to prevent XSS in server-rendered HTML
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CODE_EXPIRY_MS = 5 * 60 * 1000;
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

function generateCode(): string {
  // 8 bytes = 64-bit entropy (was 3 bytes / 24-bit — too brute-forceable)
  return crypto.randomBytes(8).toString("hex").toUpperCase();
}

// Security fix: Generate fallback secret ONCE at startup, not per-call
const _devFallbackSecret = crypto.randomBytes(32).toString("hex");

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[Cordon Auth] FATAL: SESSION_SECRET not set in production!");
      throw new Error("SESSION_SECRET must be set in production");
    }
    console.warn("[Cordon Auth] WARNING: SESSION_SECRET not set, using development fallback");
    return _devFallbackSecret;
  }
  return secret;
}

function generateJWT(userId: string, email: string): string {
  const payload = {
    sub: userId,
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor((Date.now() + SESSION_EXPIRY_MS) / 1000),
  };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secret = getSessionSecret();
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyJWT(token: string): { valid: boolean; payload?: any } {
  try {
    const [header, body, signature] = token.split(".");
    const secret = getSessionSecret();
    const expectedSig = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");

    // Security fix: Use timing-safe comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature || "", "base64url");
    const expectedBuffer = Buffer.from(expectedSig, "base64url");
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { valid: false };
    }

    const payload = JSON.parse(Buffer.from(body, "base64url").toString());

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  entry.count++;
  return true;
}

function corsMiddleware(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  const allowedOrigins = [
    "https://roachy.games",
  ];
  
  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.push("http://localhost:3000", "http://localhost:5000", "http://localhost:8081");
  }
  
  if (origin && allowedOrigins.some(o => origin.startsWith(o))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  
  next();
}

// Security: only allow redirects back to our own domains
const ALLOWED_RETURN_HOSTS = new Set([
  "app.cordonwallet.com",
  "roachy.games",
]);

function isReturnUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return ALLOWED_RETURN_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function registerCordonAuthRoutes(app: Express) {
  app.use("/auth/cordon", corsMiddleware);
  app.use("/api/auth/cordon", corsMiddleware);

  app.get("/auth/cordon/start", (req: Request, res: Response) => {
    const rawReturnUrl = req.query.returnUrl as string || "https://roachy.games";
    const returnUrl = isReturnUrlAllowed(rawReturnUrl) ? rawReturnUrl : "https://roachy.games";
    const state = crypto.randomBytes(16).toString("hex");
    
    console.log("[Cordon Auth] Starting Google OAuth flow");
    console.log("[Cordon Auth] Return URL:", returnUrl);
    
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID;
    
    if (!clientId) {
      return res.status(500).send(`
        <html>
          <head><title>Configuration Error</title></head>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1>Google OAuth Not Configured</h1>
            <p>Please set GOOGLE_WEB_CLIENT_ID environment variable.</p>
          </body>
        </html>
      `);
    }
    
    const redirectUri = `${req.protocol}://${req.get("host")}/auth/cordon/callback`;
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: `${state}:${Buffer.from(returnUrl).toString("base64url")}`,
      access_type: "offline",
      prompt: "consent",
    });
    
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.redirect(googleAuthUrl);
  });

  app.get("/auth/cordon/callback", async (req: Request, res: Response) => {
    const { code, state, error } = req.query;
    
    if (error) {
      console.error("[Cordon Auth] OAuth error:", error);
      return res.status(400).send(`
        <html>
          <head><title>Authentication Failed</title></head>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1>Authentication Failed</h1>
            <p>${escapeHtml(String(error))}</p>
            <button onclick="window.close()">Close</button>
          </body>
        </html>
      `);
    }
    
    if (!code || !state) {
      return res.status(400).send("Missing code or state");
    }

    try {
      const [, returnUrlBase64] = (state as string).split(":");
      const returnUrl = Buffer.from(returnUrlBase64 || "", "base64url").toString() || "https://roachy.games";
      
      const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET_CORDON || process.env.GOOGLE_CLIENT_SECRET;
      
      if (!clientId) {
        throw new Error("Missing client ID");
      }

      let userEmail = `user_${Date.now()}@demo.local`;
      let userName = "Demo User";
      let userId = crypto.randomBytes(8).toString("hex");
      let accessToken = "demo_token";

      if (clientSecret) {
        const redirectUri = `${req.protocol}://${req.get("host")}/auth/cordon/callback`;
        
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: code as string,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        });

        if (tokenResponse.ok) {
          const tokens = await tokenResponse.json();
          accessToken = tokens.access_token;

          const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (userInfoResponse.ok) {
            const userInfo = await userInfoResponse.json();
            userEmail = userInfo.email;
            userName = userInfo.name || userInfo.email;
            userId = userInfo.id;
          }
        }
      }

      const authCode = generateCode();
      authCodes.set(authCode, {
        code: authCode,
        userId,
        email: userEmail,
        name: userName,
        googleAccessToken: accessToken,
        createdAt: Date.now(),
        used: false,
      });

      console.log("[Cordon Auth] Code issued for user");

      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Login Successful - Cordon</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              * { box-sizing: border-box; }
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                color: white;
                min-height: 100vh;
                margin: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
              }
              .container {
                background: rgba(255,255,255,0.1);
                backdrop-filter: blur(10px);
                border-radius: 20px;
                padding: 40px;
                text-align: center;
                max-width: 400px;
                width: 100%;
              }
              .success-icon {
                width: 80px;
                height: 80px;
                background: #10b981;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 24px;
                font-size: 40px;
              }
              h1 { margin: 0 0 8px; font-size: 24px; }
              .email { color: rgba(255,255,255,0.7); margin-bottom: 32px; }
              .code-container {
                background: rgba(0,0,0,0.3);
                border-radius: 12px;
                padding: 20px;
                margin-bottom: 24px;
              }
              .code-label { font-size: 14px; color: rgba(255,255,255,0.6); margin-bottom: 8px; }
              .code {
                font-family: 'SF Mono', Monaco, monospace;
                font-size: 32px;
                font-weight: bold;
                letter-spacing: 4px;
                color: #60a5fa;
              }
              .buttons { display: flex; flex-direction: column; gap: 12px; }
              button {
                padding: 16px 24px;
                border-radius: 12px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                border: none;
                transition: transform 0.1s, opacity 0.1s;
              }
              button:active { transform: scale(0.98); }
              .copy-btn { background: rgba(255,255,255,0.1); color: white; border: 1px solid rgba(255,255,255,0.2); }
              .copy-btn:hover { background: rgba(255,255,255,0.2); }
              .copied { background: #10b981 !important; border-color: #10b981 !important; }
              .return-btn { 
                display: block;
                background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
                color: white;
                text-decoration: none;
                text-align: center;
                padding: 16px 24px;
                border-radius: 12px;
                font-size: 16px;
                font-weight: 600;
              }
              .return-btn:hover { opacity: 0.9; }
              .instructions {
                margin-top: 24px;
                padding: 16px;
                background: rgba(59,130,246,0.1);
                border-radius: 12px;
                font-size: 14px;
                color: rgba(255,255,255,0.8);
              }
              .step { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
              .step-num {
                width: 24px;
                height: 24px;
                background: #3b82f6;
                border-radius: 50%;
                font-size: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
              }
              #debug {
                margin-top: 20px;
                padding: 12px;
                background: rgba(0,0,0,0.2);
                border-radius: 8px;
                font-size: 11px;
                text-align: left;
                font-family: monospace;
                color: rgba(255,255,255,0.5);
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success-icon">&#10003;</div>
              <h1>Login Successful!</h1>
              <p class="email">${escapeHtml(userEmail)}</p>
              
              <div class="code-container">
                <div class="code-label">Your verification code</div>
                <div class="code" id="code">${escapeHtml(authCode)}</div>
              </div>
              
              <div class="buttons">
                <button class="return-btn" id="returnBtn" onclick="returnToCordon()">Return to Cordon</button>
                <button class="copy-btn" id="copyBtn" onclick="copyCode()">Copy Code</button>
              </div>
              
              <div id="return-status" style="margin-top: 12px; font-size: 13px; color: rgba(255,255,255,0.6);"></div>
              
              <div class="instructions">
                <div class="step"><span class="step-num">1</span> Tap "Return to Cordon" above</div>
                <div class="step"><span class="step-num">2</span> Or copy code and paste in app</div>
              </div>
              
              <div id="debug">
                <div>Status: CODE_ISSUED</div>
                <div>Code: ${escapeHtml(authCode)}</div>
                <div>User: ${escapeHtml(userEmail)}</div>
                <div>Time: ${escapeHtml(new Date().toISOString())}</div>
              </div>
            </div>
            
            <script>
              const deepLink = 'cordon://auth/callback?code=${authCode}';
              
              function returnToCordon() {
                const status = document.getElementById('return-status');
                status.textContent = 'Opening Cordon...';
                
                // Method 1: Direct location change
                window.location.href = deepLink;
                
                // Method 2: Fallback with timeout
                setTimeout(function() {
                  // If we're still here, try iframe method
                  var iframe = document.createElement('iframe');
                  iframe.style.display = 'none';
                  iframe.src = deepLink;
                  document.body.appendChild(iframe);
                  
                  setTimeout(function() {
                    document.body.removeChild(iframe);
                    status.textContent = 'If Cordon did not open, copy the code manually.';
                  }, 1000);
                }, 500);
              }
              
              function copyCode() {
                const code = document.getElementById('code').textContent;
                navigator.clipboard.writeText(code).then(() => {
                  const btn = document.getElementById('copyBtn');
                  btn.textContent = 'Copied!';
                  btn.classList.add('copied');
                  setTimeout(() => {
                    btn.textContent = 'Copy Code';
                    btn.classList.remove('copied');
                  }, 2000);
                });
              }
              
              // Auto-redirect after short delay
              setTimeout(function() {
                returnToCordon();
              }, 1500);
            </script>
          </body>
        </html>
      `);
    } catch (err: any) {
      console.error("[Cordon Auth] Callback error:", err);
      res.status(500).send(`
        <html>
          <head><title>Error</title></head>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1>Authentication Error</h1>
            <p>${escapeHtml(err.message)}</p>
          </body>
        </html>
      `);
    }
  });

  app.post("/api/auth/cordon/request-code", (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    
    if (!checkRateLimit(ip)) {
      console.log("[Cordon Auth] Rate limited:", ip);
      return res.status(429).json({ error: "Too many requests", retryAfter: 60 });
    }

    const { googleToken, email, name } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: "Email required" });
    }

    const code = generateCode();
    const userId = crypto.randomBytes(8).toString("hex");
    
    authCodes.set(code, {
      code,
      userId,
      email,
      name: name || email,
      googleAccessToken: googleToken || "",
      createdAt: Date.now(),
      used: false,
    });

    console.log("[Cordon Auth] Code requested for user");

    res.json({
      success: true,
      code,
      expiresIn: CODE_EXPIRY_MS / 1000,
    });
  });

  app.post("/api/auth/cordon/exchange-code", async (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";

    if (!checkRateLimit(ip)) {
      console.log("[Cordon Auth] Rate limited:", ip);
      return res.status(429).json({ error: "Too many requests", retryAfter: 60 });
    }

    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Code required" });
    }

    const codeKey = code.toUpperCase();
    const authCode = authCodes.get(codeKey);

    if (!authCode) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    // Security: Atomically delete the code from the map BEFORE processing.
    // This prevents race conditions where two parallel requests both read
    // the same code as valid and both create sessions.
    authCodes.delete(codeKey);

    if (authCode.used) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    if (Date.now() - authCode.createdAt > CODE_EXPIRY_MS) {
      return res.status(400).json({ error: "Invalid or expired code" });
    }

    authCode.used = true;

    const jwt = generateJWT(authCode.userId, authCode.email);
    const sessionId = crypto.randomBytes(16).toString("hex");

    try {
      await db.insert(cordonSessions).values({
        id: sessionId,
        userId: authCode.userId,
        email: authCode.email,
        name: authCode.name,
        jwt,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_EXPIRY_MS,
      });
    } catch (err) {
      console.error("[Cordon Auth] Failed to persist session:", err);
      return res.status(500).json({ error: "Failed to create session" });
    }

    console.log("[Cordon Auth] Code exchanged, session created (DB-persisted)");

    res.cookie("cordon_session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // Security: never use "none" — it enables CSRF attacks
      path: "/",
      maxAge: SESSION_EXPIRY_MS,
    });

    res.json({
      success: true,
      user: {
        id: authCode.userId,
        email: authCode.email,
        name: authCode.name,
      },
      jwt,
      sessionId,
      expiresIn: SESSION_EXPIRY_MS / 1000,
    });
  });

  app.get("/api/auth/cordon/session", async (req: Request, res: Response) => {
    const sessionId = req.cookies?.cordon_session;
    const authHeader = req.headers.authorization;

    // Try DB-persisted session first
    if (sessionId) {
      try {
        const rows = await db.select().from(cordonSessions)
          .where(eq(cordonSessions.id, sessionId))
          .limit(1);
        const session = rows[0];

        if (session && Date.now() <= session.expiresAt) {
          return res.json({
            authenticated: true,
            user: {
              id: session.userId,
              email: session.email,
              name: session.name,
            },
          });
        }

        // Session found but expired — clean it up
        if (session) {
          await db.delete(cordonSessions).where(eq(cordonSessions.id, sessionId));
        }
      } catch (err) {
        console.error("[Cordon Auth] Session DB lookup failed:", err);
      }
    }

    // Fallback: JWT in Authorization header
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { valid, payload } = verifyJWT(token);

      if (valid && payload) {
        return res.json({
          authenticated: true,
          user: {
            id: payload.sub,
            email: payload.email,
          },
        });
      }
    }

    return res.json({
      authenticated: false,
    });
  });

  app.post("/api/auth/cordon/logout", async (req: Request, res: Response) => {
    const sessionId = req.cookies?.cordon_session;

    if (sessionId) {
      try {
        await db.delete(cordonSessions).where(eq(cordonSessions.id, sessionId));
      } catch (err) {
        console.error("[Cordon Auth] Failed to delete session:", err);
      }
    }

    res.clearCookie("cordon_session", { path: "/" });
    res.json({ success: true });
  });

  app.post("/api/auth/cordon/mobile/start", async (req: Request, res: Response) => {
    const sessionId = crypto.randomBytes(16).toString("hex");
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    
    try {
      await createMobileSession(sessionId, codeVerifier);
      console.log("[Cordon Mobile Auth] Session created in DB:", sessionId);
    } catch (err) {
      console.error("[Cordon Mobile Auth] Failed to create session:", err);
      return res.status(500).json({ error: "Failed to create session" });
    }
    
    const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
    const forwardedHost = req.get("x-forwarded-host") || req.get("host") || "";

    const hostname = forwardedHost.split(":")[0];
    const expressPort = process.env.PORT || "5000";

    let baseUrl: string;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      baseUrl = `${protocol}://${hostname}:${expressPort}`;
    } else {
      baseUrl = `${protocol}://${hostname}`;
    }
    
    const authStartUrl = `${baseUrl}/auth/cordon/mobile/start?sessionId=${sessionId}`;
    console.log("[Cordon Mobile Auth] Auth URL with backend port:", authStartUrl);
    
    res.json({
      sessionId,
      authUrl: authStartUrl,
    });
  });

  app.get("/auth/cordon/mobile/start", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    
    if (!sessionId) {
      return res.status(400).send("Missing sessionId");
    }
    
    const session = await getMobileSession(sessionId);
    if (!session) {
      return res.status(400).send("Invalid or expired session");
    }
    
    if (Date.now() - session.createdAt > MOBILE_SESSION_EXPIRY_MS) {
      await deleteMobileSession(sessionId);
      return res.status(400).send("Session expired");
    }
    
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID;
    
    if (!clientId) {
      await updateMobileSession(sessionId, { status: "error", error: "OAuth not configured" });
      return res.status(500).send("OAuth not configured");
    }
    
    // Always use production domain for mobile OAuth redirect URI
    // This must match what's registered in Google Cloud Console
    const baseUrl = "https://app.cordonwallet.com";
    const redirectUri = `${baseUrl}/auth/cordon/mobile/callback`;
    console.log("[Cordon Mobile Auth] Using production redirect URI:", redirectUri);
    console.log("[Cordon Mobile Auth] Redirect URI:", redirectUri);
    const codeChallenge = crypto.createHash("sha256").update(session.codeVerifier || "").digest("base64url");
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: sessionId,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "select_account",
    });
    
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    console.log("[Cordon Mobile Auth] Redirecting to Google OAuth:", googleAuthUrl);
    res.redirect(googleAuthUrl);
  });

  app.get("/auth/cordon/mobile/callback", async (req: Request, res: Response) => {
    const { code, state, error } = req.query;
    const sessionId = state as string;
    
    console.log("[Cordon Mobile Auth] Callback received:", { code: code ? "present" : "missing", sessionId, error });
    
    if (!sessionId) {
      return res.status(400).send("Missing state/sessionId");
    }
    
    const session = await getMobileSession(sessionId);
    if (!session) {
      return res.status(400).send("Invalid or expired session");
    }
    
    if (error) {
      await updateMobileSession(sessionId, { status: "error", error: error as string });
      return res.send(`
        <!DOCTYPE html>
        <html>
          <head><title>Authentication Failed</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>body { font-family: system-ui; padding: 40px; text-align: center; background: #1a1a2e; color: white; }</style>
          </head>
          <body>
            <h1>Authentication Failed</h1>
            <p>${escapeHtml(String(error))}</p>
            <p>You can close this window and try again.</p>
          </body>
        </html>
      `);
    }
    
    if (!code) {
      await updateMobileSession(sessionId, { status: "error", error: "No code received" });
      return res.status(400).send("Missing authorization code");
    }
    
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET_CORDON || process.env.GOOGLE_CLIENT_SECRET;
    
    // Always use production domain - must match what was used in /start
    const baseUrl = "https://app.cordonwallet.com";
    const redirectUri = `${baseUrl}/auth/cordon/mobile/callback`;
    
    if (!clientSecret) {
      console.log("[Cordon Mobile Auth] No GOOGLE_CLIENT_SECRET_CORDON or GOOGLE_CLIENT_SECRET available, returning code only");
      await updateMobileSession(sessionId, {
        status: "success",
        code: code as string,
      });
    } else {
      try {
        console.log("[Cordon Mobile Auth] Exchanging code for tokens...");
        console.log("[Cordon Mobile Auth] Using redirect_uri:", redirectUri);
        
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: code as string,
            client_id: clientId || "",
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
            code_verifier: session.codeVerifier || "",
          }),
        });
        
        const tokenData = await tokenResponse.json() as any;
        
        if (tokenData.error) {
          console.error("[Cordon Mobile Auth] Token exchange error:", tokenData);
          console.log("[Cordon Mobile Auth] Falling back to code-only mode");
          await updateMobileSession(sessionId, {
            status: "success",
            code: code as string,
          });
        } else {
          console.log("[Cordon Mobile Auth] Token exchange successful, id_token received");
          await updateMobileSession(sessionId, {
            status: "success",
            code: code as string,
            idToken: tokenData.id_token,
            accessToken: tokenData.access_token,
          });
          console.log("[Cordon Mobile Auth] Success! Tokens stored for session:", sessionId);
        }
      } catch (err: any) {
        console.error("[Cordon Mobile Auth] Token exchange failed:", err);
        await updateMobileSession(sessionId, {
          status: "success",
          code: code as string,
        });
      }
    }
    
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>Success - Cordon</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, system-ui; padding: 40px; text-align: center; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; min-height: 100vh; margin: 0; display: flex; align-items: center; justify-content: center; }
            .container { background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); border-radius: 20px; padding: 40px; max-width: 400px; }
            .success-icon { width: 80px; height: 80px; background: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-size: 40px; }
            h1 { margin: 0 0 16px; }
            p { color: rgba(255,255,255,0.7); }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✓</div>
            <h1>Login Successful!</h1>
            <p>You can now close this window and return to the Cordon app.</p>
          </div>
        </body>
      </html>
    `);
  });

  app.get("/api/auth/cordon/mobile/poll", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    
    try {
      const session = await getMobileSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found or expired" });
      }
      
      if (Date.now() - session.createdAt > MOBILE_SESSION_EXPIRY_MS) {
        await deleteMobileSession(sessionId);
        return res.status(410).json({ error: "Session expired" });
      }
      
      if (session.status === "pending") {
        return res.json({ status: "pending" });
      }
      
      if (session.status === "error") {
        await deleteMobileSession(sessionId);
        return res.json({ status: "error", error: session.error });
      }
      
      if (session.status === "success") {
        await deleteMobileSession(sessionId);
        return res.json({
          status: "success",
          code: session.code,
          codeVerifier: session.codeVerifier,
          idToken: session.idToken,
          accessToken: session.accessToken,
        });
      }
      
      res.json({ status: "unknown" });
    } catch (err) {
      console.error("[Cordon Mobile Auth] Poll error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Security: Debug endpoint removed — it leaked active auth codes and sessions.
  // Kept as a 404 so existing clients don't hang.
  app.get("/api/auth/cordon/debug", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  console.log("[Cordon Auth] Routes registered");
}
