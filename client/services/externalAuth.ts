import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import { Platform } from "react-native";

WebBrowser.maybeCompleteAuthSession();

const SECURE_AUTH_STATE_KEY = "cordon_auth_state";
const SECURE_AUTH_VERIFIER_KEY = "cordon_auth_verifier";
const SECURE_AUTH_RETURN_URL_KEY = "cordon_auth_return_url";
const SECURE_AUTH_REQUEST_KEY = "cordon_auth_request";

const GOOGLE_DISCOVERY = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

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
    return process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || 
           process.env.GOOGLE_IOS_CLIENT_ID || "";
  } else if (Platform.OS === "android") {
    return process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || 
           process.env.GOOGLE_ANDROID_CLIENT_ID || "";
  }
  return process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || 
         process.env.GOOGLE_WEB_CLIENT_ID || "";
}

function getRedirectUri(): string {
  if (Platform.OS === "ios") {
    const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "";
    if (iosClientId) {
      const reversedClientId = iosClientId.split(".").reverse().join(".");
      return `${reversedClientId}:/oauth2redirect`;
    }
  }
  return AuthSession.makeRedirectUri({
    scheme: "cordon",
    path: "auth/callback",
  });
}

export async function storeAuthState(authState: AuthState): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SECURE_AUTH_STATE_KEY, authState.state),
    SecureStore.setItemAsync(SECURE_AUTH_VERIFIER_KEY, authState.codeVerifier),
    SecureStore.setItemAsync(SECURE_AUTH_RETURN_URL_KEY, authState.returnUrl),
    SecureStore.setItemAsync(SECURE_AUTH_REQUEST_KEY, JSON.stringify({
      provider: authState.provider,
      startedAt: authState.startedAt,
    })),
  ]);
}

export async function getStoredAuthState(): Promise<AuthState | null> {
  const [state, codeVerifier, returnUrl, requestJson] = await Promise.all([
    SecureStore.getItemAsync(SECURE_AUTH_STATE_KEY),
    SecureStore.getItemAsync(SECURE_AUTH_VERIFIER_KEY),
    SecureStore.getItemAsync(SECURE_AUTH_RETURN_URL_KEY),
    SecureStore.getItemAsync(SECURE_AUTH_REQUEST_KEY),
  ]);

  if (!state || !codeVerifier || !returnUrl || !requestJson) {
    return null;
  }

  try {
    const request = JSON.parse(requestJson);
    return {
      state,
      codeVerifier,
      returnUrl,
      provider: request.provider || "google",
      startedAt: request.startedAt || 0,
    };
  } catch {
    return null;
  }
}

export async function clearAuthState(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SECURE_AUTH_STATE_KEY),
    SecureStore.deleteItemAsync(SECURE_AUTH_VERIFIER_KEY),
    SecureStore.deleteItemAsync(SECURE_AUTH_RETURN_URL_KEY),
    SecureStore.deleteItemAsync(SECURE_AUTH_REQUEST_KEY),
  ]);
}

export async function startGoogleAuth(returnUrl: string): Promise<{ 
  success: boolean; 
  error?: string;
  completionUrl?: string;
}> {
  const clientId = getGoogleClientId();
  
  if (!clientId) {
    return { 
      success: false, 
      error: "Google OAuth is not configured for this platform" 
    };
  }

  try {
    const redirectUri = getRedirectUri();

    const request = new AuthSession.AuthRequest({
      clientId,
      redirectUri,
      scopes: ["openid", "email", "profile"],
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      extraParams: {
        access_type: "offline",
        prompt: "select_account",
      },
    });

    await request.makeAuthUrlAsync(GOOGLE_DISCOVERY);

    const authState: AuthState = {
      state: request.state!,
      codeVerifier: request.codeVerifier!,
      returnUrl,
      provider: "google",
      startedAt: Date.now(),
    };

    await storeAuthState(authState);

    const result = await request.promptAsync(GOOGLE_DISCOVERY, {
      showInRecents: true,
    });

    if (result.type === "cancel" || result.type === "dismiss") {
      await clearAuthState();
      return { success: false, error: "Authentication was cancelled" };
    }

    if (result.type === "error") {
      await clearAuthState();
      return { 
        success: false, 
        error: result.error?.message || "Authentication failed" 
      };
    }

    if (result.type === "success" && result.params.code) {
      const completionResult = await completeGoogleAuth(
        result.params.code,
        authState.codeVerifier,
        authState.returnUrl,
        redirectUri
      );
      return completionResult;
    }

    await clearAuthState();
    return { success: false, error: "No authorization code received" };
  } catch (error: any) {
    await clearAuthState();
    return { success: false, error: error.message || "Failed to start authentication" };
  }
}

export async function exchangeCodeForTokens(
  code: string, 
  codeVerifier: string,
  redirectUri: string
): Promise<TokenResponse> {
  const clientId = getGoogleClientId();

  const params = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const response = await fetch(GOOGLE_DISCOVERY.tokenEndpoint, {
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

export async function completeGoogleAuth(
  code: string,
  codeVerifier: string,
  returnUrl: string,
  redirectUri: string
): Promise<{ success: boolean; completionUrl?: string; error?: string }> {
  try {
    const tokens = await exchangeCodeForTokens(code, codeVerifier, redirectUri);

    if (!tokens.id_token) {
      await clearAuthState();
      return { success: false, error: "No ID token received from Google" };
    }

    const roachyResponse = await exchangeWithRoachy(tokens.id_token, returnUrl);

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
      if (parsedUrl.pathname.includes("/auth/google/secure") || 
          parsedUrl.pathname.includes("/auth/cordon/start")) {
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
    const url = new URL(triggerUrl);
    const returnUrl = url.searchParams.get("returnUrl") || url.searchParams.get("return_url");
    if (returnUrl) {
      return returnUrl;
    }
    return "https://roachy.games";
  } catch {
    return "https://roachy.games";
  }
}

export function getAuthConfig() {
  return {
    redirectUri: getRedirectUri(),
    clientId: getGoogleClientId(),
    hasClientId: !!getGoogleClientId(),
    platform: Platform.OS,
  };
}
