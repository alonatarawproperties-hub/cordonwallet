import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { sha256 } from "@noble/hashes/sha2.js";
import { Platform } from "react-native";

const SECURE_AUTH_STATE_KEY = "cordon_auth_state";
const SECURE_AUTH_VERIFIER_KEY = "cordon_auth_verifier";
const SECURE_AUTH_RETURN_URL_KEY = "cordon_auth_return_url";
const SECURE_AUTH_PROVIDER_KEY = "cordon_auth_provider";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_CLIENT_ID_IOS = "YOUR_GOOGLE_CLIENT_ID_IOS.apps.googleusercontent.com";
const GOOGLE_CLIENT_ID_ANDROID = "YOUR_GOOGLE_CLIENT_ID_ANDROID.apps.googleusercontent.com";
const GOOGLE_CLIENT_ID_WEB = "YOUR_GOOGLE_CLIENT_ID_WEB.apps.googleusercontent.com";

const REDIRECT_URI = "cordon://auth/callback";

export interface AuthState {
  state: string;
  codeVerifier: string;
  returnUrl: string;
  provider: "google";
  startedAt: number;
}

export interface AuthCallbackParams {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

export interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface RoachyAuthResponse {
  token: string;
  returnUrl: string;
}

function getGoogleClientId(): string {
  if (Platform.OS === "ios") {
    return GOOGLE_CLIENT_ID_IOS;
  } else if (Platform.OS === "android") {
    return GOOGLE_CLIENT_ID_ANDROID;
  }
  return GOOGLE_CLIENT_ID_WEB;
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  const randomValues = new Uint8Array(length);
  globalThis.crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

function generateCodeChallenge(verifier: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = sha256(data);
  const base64 = btoa(String.fromCharCode(...digest));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function storeAuthState(authState: AuthState): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SECURE_AUTH_STATE_KEY, authState.state),
    SecureStore.setItemAsync(SECURE_AUTH_VERIFIER_KEY, authState.codeVerifier),
    SecureStore.setItemAsync(SECURE_AUTH_RETURN_URL_KEY, authState.returnUrl),
    SecureStore.setItemAsync(SECURE_AUTH_PROVIDER_KEY, authState.provider),
  ]);
}

export async function getStoredAuthState(): Promise<AuthState | null> {
  const [state, codeVerifier, returnUrl, provider] = await Promise.all([
    SecureStore.getItemAsync(SECURE_AUTH_STATE_KEY),
    SecureStore.getItemAsync(SECURE_AUTH_VERIFIER_KEY),
    SecureStore.getItemAsync(SECURE_AUTH_RETURN_URL_KEY),
    SecureStore.getItemAsync(SECURE_AUTH_PROVIDER_KEY),
  ]);

  if (!state || !codeVerifier || !returnUrl || !provider) {
    return null;
  }

  return {
    state,
    codeVerifier,
    returnUrl,
    provider: provider as "google",
    startedAt: 0,
  };
}

export async function clearAuthState(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SECURE_AUTH_STATE_KEY),
    SecureStore.deleteItemAsync(SECURE_AUTH_VERIFIER_KEY),
    SecureStore.deleteItemAsync(SECURE_AUTH_RETURN_URL_KEY),
    SecureStore.deleteItemAsync(SECURE_AUTH_PROVIDER_KEY),
  ]);
}

export async function startGoogleAuth(returnUrl: string): Promise<{ success: boolean; error?: string }> {
  try {
    const state = generateRandomString(32);
    const codeVerifier = generateRandomString(64);
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const authState: AuthState = {
      state,
      codeVerifier,
      returnUrl,
      provider: "google",
      startedAt: Date.now(),
    };

    await storeAuthState(authState);

    const params = new URLSearchParams({
      client_id: getGoogleClientId(),
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });

    const authUrl = `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;

    const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI, {
      showInRecents: true,
      preferEphemeralSession: false,
    });

    if (result.type === "cancel" || result.type === "dismiss") {
      await clearAuthState();
      return { success: false, error: "Authentication was cancelled" };
    }

    if (result.type === "success" && result.url) {
      return { success: true };
    }

    return { success: false, error: "Authentication failed" };
  } catch (error: any) {
    await clearAuthState();
    return { success: false, error: error.message || "Failed to start authentication" };
  }
}

export function parseAuthCallback(url: string): AuthCallbackParams {
  const parsed = Linking.parse(url);
  const queryParams = parsed.queryParams || {};

  return {
    code: queryParams.code as string | undefined,
    state: queryParams.state as string | undefined,
    error: queryParams.error as string | undefined,
    error_description: queryParams.error_description as string | undefined,
  };
}

export async function validateAuthCallback(params: AuthCallbackParams): Promise<{ valid: boolean; error?: string; authState?: AuthState }> {
  if (params.error) {
    await clearAuthState();
    return {
      valid: false,
      error: params.error_description || params.error || "Authentication error",
    };
  }

  if (!params.code || !params.state) {
    await clearAuthState();
    return {
      valid: false,
      error: "Missing authorization code or state",
    };
  }

  const storedState = await getStoredAuthState();

  if (!storedState) {
    return {
      valid: false,
      error: "No pending authentication session found",
    };
  }

  if (storedState.state !== params.state) {
    await clearAuthState();
    return {
      valid: false,
      error: "State mismatch - possible CSRF attack",
    };
  }

  const elapsed = Date.now() - storedState.startedAt;
  if (elapsed > 10 * 60 * 1000) {
    await clearAuthState();
    return {
      valid: false,
      error: "Authentication session expired",
    };
  }

  return {
    valid: true,
    authState: storedState,
  };
}

export async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  });

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error_description || errorData.error || "Failed to exchange code for tokens");
  }

  return response.json();
}

export async function exchangeWithRoachy(idToken: string, returnUrl: string): Promise<RoachyAuthResponse> {
  const response = await fetch("https://roachy.games/api/auth/cordon/google", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idToken,
      returnUrl,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || "Failed to authenticate with Roachy");
  }

  return response.json();
}

export async function completeGoogleAuth(code: string): Promise<{ success: boolean; completionUrl?: string; error?: string }> {
  try {
    const storedState = await getStoredAuthState();

    if (!storedState) {
      return { success: false, error: "No pending authentication session" };
    }

    const tokens = await exchangeCodeForTokens(code, storedState.codeVerifier);

    if (!tokens.id_token) {
      await clearAuthState();
      return { success: false, error: "No ID token received from Google" };
    }

    const roachyResponse = await exchangeWithRoachy(tokens.id_token, storedState.returnUrl);

    await clearAuthState();

    const completionUrl = `https://roachy.games/auth/cordon/complete?token=${encodeURIComponent(roachyResponse.token)}&returnUrl=${encodeURIComponent(roachyResponse.returnUrl)}`;

    return {
      success: true,
      completionUrl,
    };
  } catch (error: any) {
    await clearAuthState();
    return {
      success: false,
      error: error.message || "Failed to complete authentication",
    };
  }
}

export function isRoachyAuthTrigger(url: string): boolean {
  try {
    if (url.startsWith("cordon://auth/start")) {
      return true;
    }

    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === "roachy.games" || parsedUrl.hostname.endsWith(".roachy.games")) {
      if (parsedUrl.pathname.includes("/auth/google/secure")) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export function extractReturnUrl(triggerUrl: string): string {
  try {
    const parsed = Linking.parse(triggerUrl);
    if (parsed.queryParams?.returnUrl) {
      return parsed.queryParams.returnUrl as string;
    }

    const url = new URL(triggerUrl);
    const returnUrl = url.searchParams.get("returnUrl");
    if (returnUrl) {
      return returnUrl;
    }

    return "https://roachy.games";
  } catch {
    return "https://roachy.games";
  }
}
