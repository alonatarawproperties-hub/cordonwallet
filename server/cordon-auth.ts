import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";

interface AuthCode {
  code: string;
  userId: string;
  email: string;
  name: string;
  googleAccessToken: string;
  createdAt: number;
  used: boolean;
}

interface Session {
  id: string;
  userId: string;
  email: string;
  name: string;
  jwt: string;
  createdAt: number;
  expiresAt: number;
}

interface MobileAuthSession {
  sessionId: string;
  status: "pending" | "success" | "error";
  code?: string;
  codeVerifier?: string;
  idToken?: string;
  accessToken?: string;
  error?: string;
  createdAt: number;
}

const authCodes = new Map<string, AuthCode>();
const sessions = new Map<string, Session>();
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const mobileAuthSessions = new Map<string, MobileAuthSession>();

const MOBILE_SESSION_EXPIRY_MS = 10 * 60 * 1000;

const CODE_EXPIRY_MS = 5 * 60 * 1000;
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

function generateCode(): string {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.warn("[Cordon Auth] WARNING: SESSION_SECRET not set, using development fallback");
    return crypto.randomBytes(32).toString("hex");
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
    
    if (signature !== expectedSig) {
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

export function registerCordonAuthRoutes(app: Express) {
  app.use("/auth/cordon", corsMiddleware);
  app.use("/api/auth/cordon", corsMiddleware);

  app.get("/auth/cordon/start", (req: Request, res: Response) => {
    const returnUrl = req.query.returnUrl as string || "https://roachy.games";
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
            <p>${error}</p>
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
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      
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

      console.log("[Cordon Auth] Code issued:", authCode);
      console.log("[Cordon Auth] User:", userEmail);

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
              <p class="email">${userEmail}</p>
              
              <div class="code-container">
                <div class="code-label">Your verification code</div>
                <div class="code" id="code">${authCode}</div>
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
                <div>Code: ${authCode}</div>
                <div>User: ${userEmail}</div>
                <div>Time: ${new Date().toISOString()}</div>
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
            <p>${err.message}</p>
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

    console.log("[Cordon Auth] Code requested:", code, "for", email);

    res.json({
      success: true,
      code,
      expiresIn: CODE_EXPIRY_MS / 1000,
      debug: {
        step: "CODE_ISSUED",
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.post("/api/auth/cordon/exchange-code", (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    
    if (!checkRateLimit(ip)) {
      console.log("[Cordon Auth] Rate limited:", ip);
      return res.status(429).json({ error: "Too many requests", retryAfter: 60 });
    }

    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: "Code required" });
    }

    const authCode = authCodes.get(code.toUpperCase());
    
    if (!authCode) {
      console.log("[Cordon Auth] Invalid code:", code);
      return res.status(400).json({ error: "Invalid code", debug: { step: "CODE_INVALID" } });
    }

    if (authCode.used) {
      console.log("[Cordon Auth] Code already used:", code);
      return res.status(400).json({ error: "Code already used", debug: { step: "CODE_USED" } });
    }

    if (Date.now() - authCode.createdAt > CODE_EXPIRY_MS) {
      console.log("[Cordon Auth] Code expired:", code);
      authCodes.delete(code);
      return res.status(400).json({ error: "Code expired", debug: { step: "CODE_EXPIRED" } });
    }

    authCode.used = true;

    const jwt = generateJWT(authCode.userId, authCode.email);
    const sessionId = crypto.randomBytes(16).toString("hex");
    
    const session: Session = {
      id: sessionId,
      userId: authCode.userId,
      email: authCode.email,
      name: authCode.name,
      jwt,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_EXPIRY_MS,
    };
    
    sessions.set(sessionId, session);

    console.log("[Cordon Auth] Code exchanged:", code);
    console.log("[Cordon Auth] Session created:", sessionId);

    res.cookie("cordon_session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
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
      debug: {
        step: "LOGGED_IN",
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.get("/api/auth/cordon/session", (req: Request, res: Response) => {
    const sessionId = req.cookies?.cordon_session;
    const authHeader = req.headers.authorization;
    
    let session: Session | undefined;

    if (sessionId) {
      session = sessions.get(sessionId);
    }

    if (!session && authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { valid, payload } = verifyJWT(token);
      
      if (valid && payload) {
        return res.json({
          authenticated: true,
          user: {
            id: payload.sub,
            email: payload.email,
          },
          debug: {
            method: "jwt",
            step: "LOGGED_IN",
          },
        });
      }
    }

    if (!session || Date.now() > session.expiresAt) {
      return res.json({
        authenticated: false,
        debug: {
          step: "NO_SESSION",
          hasCookie: !!sessionId,
          hasJwt: !!authHeader,
        },
      });
    }

    res.json({
      authenticated: true,
      user: {
        id: session.userId,
        email: session.email,
        name: session.name,
      },
      debug: {
        method: "session",
        step: "LOGGED_IN",
        sessionId: session.id.slice(0, 8) + "...",
      },
    });
  });

  app.post("/api/auth/cordon/logout", (req: Request, res: Response) => {
    const sessionId = req.cookies?.cordon_session;
    
    if (sessionId) {
      sessions.delete(sessionId);
    }

    res.clearCookie("cordon_session", { path: "/" });
    res.json({ success: true, debug: { step: "LOGGED_OUT" } });
  });

  app.post("/api/auth/cordon/mobile/start", (req: Request, res: Response) => {
    const sessionId = crypto.randomBytes(16).toString("hex");
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    
    mobileAuthSessions.set(sessionId, {
      sessionId,
      status: "pending",
      codeVerifier,
      createdAt: Date.now(),
    });
    
    console.log("[Cordon Mobile Auth] Session created:", sessionId);
    
    // Replit routes external port 80 to Expo (8081), but Express is on port 5000
    // We need to construct a URL that explicitly targets the Express backend using :5000
    const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
    const forwardedHost = req.get("x-forwarded-host") || req.get("host") || "";
    
    // Extract hostname without port
    const hostname = forwardedHost.split(":")[0];
    const expressPort = process.env.PORT || "5000";
    
    // For Replit development (.replit.dev), add :5000 to route to Express instead of Expo
    // For production (.replit.app) and custom domains, no port needed
    let baseUrl: string;
    if (hostname.includes(".replit.dev")) {
      // Development: use hostname:5000 format (Expo is on port 80)
      baseUrl = `${protocol}://${hostname}:${expressPort}`;
    } else if (hostname === "localhost" || hostname === "127.0.0.1") {
      // Local development
      baseUrl = `${protocol}://${hostname}:${expressPort}`;
    } else {
      // Production (.replit.app) and custom domains: no port needed
      baseUrl = `${protocol}://${hostname}`;
    }
    
    const authStartUrl = `${baseUrl}/auth/cordon/mobile/start?sessionId=${sessionId}`;
    console.log("[Cordon Mobile Auth] Auth URL with backend port:", authStartUrl);
    
    res.json({
      sessionId,
      authUrl: authStartUrl,
    });
  });

  app.get("/auth/cordon/mobile/start", (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    
    if (!sessionId) {
      return res.status(400).send("Missing sessionId");
    }
    
    const session = mobileAuthSessions.get(sessionId);
    if (!session) {
      return res.status(400).send("Invalid or expired session");
    }
    
    const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID;
    
    if (!clientId) {
      mobileAuthSessions.set(sessionId, { ...session, status: "error", error: "OAuth not configured" });
      return res.status(500).send("OAuth not configured");
    }
    
    // Use environment variables to construct the redirect URI reliably
    // REPLIT_DEV_DOMAIN is set in development, REPLIT_INTERNAL_APP_DOMAIN in production
    const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
    const replitAppDomain = process.env.REPLIT_INTERNAL_APP_DOMAIN;
    const expressPort = process.env.PORT || "5000";
    
    let baseUrl: string;
    if (replitDevDomain) {
      // Development on Replit: always use port 5000
      baseUrl = `https://${replitDevDomain}:${expressPort}`;
      console.log("[Cordon Mobile Auth] Using dev domain with port:", baseUrl);
    } else if (replitAppDomain) {
      // Production on Replit: no port needed
      baseUrl = `https://${replitAppDomain}`;
      console.log("[Cordon Mobile Auth] Using production domain:", baseUrl);
    } else {
      // Fallback to request headers
      const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
      const forwardedHost = req.get("x-forwarded-host") || req.get("host") || "";
      baseUrl = `${protocol}://${forwardedHost}`;
      console.log("[Cordon Mobile Auth] Using fallback host:", baseUrl);
    }
    
    const redirectUri = `${baseUrl}/auth/cordon/mobile/callback`;
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
    
    const session = mobileAuthSessions.get(sessionId);
    if (!session) {
      return res.status(400).send("Invalid or expired session");
    }
    
    if (error) {
      mobileAuthSessions.set(sessionId, { ...session, status: "error", error: error as string });
      return res.send(`
        <!DOCTYPE html>
        <html>
          <head><title>Authentication Failed</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>body { font-family: system-ui; padding: 40px; text-align: center; background: #1a1a2e; color: white; }</style>
          </head>
          <body>
            <h1>Authentication Failed</h1>
            <p>${error}</p>
            <p>You can close this window and try again.</p>
          </body>
        </html>
      `);
    }
    
    if (!code) {
      mobileAuthSessions.set(sessionId, { ...session, status: "error", error: "No code received" });
      return res.status(400).send("Missing authorization code");
    }
    
    try {
      const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      
      const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
      const replitAppDomain = process.env.REPLIT_APP_DOMAIN;
      const expressPort = process.env.EXPRESS_PORT || "5000";
      
      let baseUrl: string;
      if (replitDevDomain) {
        baseUrl = `https://${replitDevDomain}:${expressPort}`;
      } else if (replitAppDomain) {
        baseUrl = `https://${replitAppDomain}`;
      } else {
        const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
        const forwardedHost = req.get("x-forwarded-host") || req.get("host") || "";
        baseUrl = `${protocol}://${forwardedHost}`;
      }
      
      const redirectUri = `${baseUrl}/auth/cordon/mobile/callback`;
      
      console.log("[Cordon Mobile Auth] Exchanging code for tokens...");
      console.log("[Cordon Mobile Auth] Using redirect_uri:", redirectUri);
      
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: code as string,
          client_id: clientId || "",
          client_secret: clientSecret || "",
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: session.codeVerifier || "",
        }),
      });
      
      const tokenData = await tokenResponse.json() as any;
      
      if (tokenData.error) {
        console.error("[Cordon Mobile Auth] Token exchange error:", tokenData);
        mobileAuthSessions.set(sessionId, { 
          ...session, 
          status: "error", 
          error: tokenData.error_description || tokenData.error 
        });
        return res.send(`
          <!DOCTYPE html>
          <html>
            <head><title>Authentication Failed</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>body { font-family: system-ui; padding: 40px; text-align: center; background: #1a1a2e; color: white; }</style>
            </head>
            <body>
              <h1>Authentication Failed</h1>
              <p>Failed to complete sign-in. Please try again.</p>
            </body>
          </html>
        `);
      }
      
      console.log("[Cordon Mobile Auth] Token exchange successful, id_token received");
      
      mobileAuthSessions.set(sessionId, {
        ...session,
        status: "success",
        code: code as string,
        idToken: tokenData.id_token,
        accessToken: tokenData.access_token,
      });
      
      console.log("[Cordon Mobile Auth] Success! Tokens stored for session:", sessionId);
      
    } catch (err: any) {
      console.error("[Cordon Mobile Auth] Token exchange failed:", err);
      mobileAuthSessions.set(sessionId, {
        ...session,
        status: "success",
        code: code as string,
      });
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

  app.get("/api/auth/cordon/mobile/poll", (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    
    const session = mobileAuthSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found or expired" });
    }
    
    if (Date.now() - session.createdAt > MOBILE_SESSION_EXPIRY_MS) {
      mobileAuthSessions.delete(sessionId);
      return res.status(410).json({ error: "Session expired" });
    }
    
    if (session.status === "pending") {
      return res.json({ status: "pending" });
    }
    
    if (session.status === "error") {
      mobileAuthSessions.delete(sessionId);
      return res.json({ status: "error", error: session.error });
    }
    
    if (session.status === "success") {
      mobileAuthSessions.delete(sessionId);
      return res.json({
        status: "success",
        code: session.code,
        codeVerifier: session.codeVerifier,
        idToken: session.idToken,
        accessToken: session.accessToken,
      });
    }
    
    res.json({ status: "unknown" });
  });

  app.get("/api/auth/cordon/debug", (req: Request, res: Response) => {
    const activeCodes = Array.from(authCodes.entries())
      .filter(([, c]) => !c.used && Date.now() - c.createdAt < CODE_EXPIRY_MS)
      .map(([code, c]) => ({
        code,
        email: c.email,
        age: Math.floor((Date.now() - c.createdAt) / 1000) + "s",
      }));

    const activeSessions = Array.from(sessions.entries())
      .filter(([, s]) => Date.now() < s.expiresAt)
      .map(([id, s]) => ({
        id: id.slice(0, 8) + "...",
        email: s.email,
        expiresIn: Math.floor((s.expiresAt - Date.now()) / 1000 / 60) + "m",
      }));

    const activeMobileSessions = Array.from(mobileAuthSessions.entries())
      .filter(([, s]) => Date.now() - s.createdAt < MOBILE_SESSION_EXPIRY_MS)
      .map(([id, s]) => ({
        id: id.slice(0, 8) + "...",
        status: s.status,
        age: Math.floor((Date.now() - s.createdAt) / 1000) + "s",
      }));

    res.json({
      activeCodes,
      activeCodeCount: activeCodes.length,
      activeSessions,
      activeSessionCount: activeSessions.length,
      activeMobileSessions,
      activeMobileSessionCount: activeMobileSessions.length,
      timestamp: new Date().toISOString(),
    });
  });

  console.log("[Cordon Auth] Routes registered:");
  console.log("  GET  /auth/cordon/start");
  console.log("  GET  /auth/cordon/callback");
  console.log("  POST /api/auth/cordon/request-code");
  console.log("  POST /api/auth/cordon/exchange-code");
  console.log("  GET  /api/auth/cordon/session");
  console.log("  POST /api/auth/cordon/logout");
  console.log("  POST /api/auth/cordon/mobile/start");
  console.log("  GET  /auth/cordon/mobile/start");
  console.log("  GET  /auth/cordon/mobile/callback");
  console.log("  GET  /api/auth/cordon/mobile/poll");
  console.log("  GET  /api/auth/cordon/debug");
}
