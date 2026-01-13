import { useEffect, useCallback } from "react";
import { Alert, Platform } from "react-native";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as Haptics from "expo-haptics";
import { getApiUrl } from "@/lib/query-client";

const AUTH_JWT_KEY = "cordon_external_auth_jwt";
const AUTH_USER_KEY = "cordon_external_auth_user";

export function AuthDeepLinkHandler() {
  const handleAuthCallback = useCallback(async (code: string) => {
    console.log("[AuthDeepLink] Received auth code:", code);

    try {
      const response = await fetch(`${getApiUrl()}/api/auth/cordon/exchange-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to exchange code");
      }

      console.log("[AuthDeepLink] Code exchange successful:", data.user?.email);

      if (data.jwt) {
        await SecureStore.setItemAsync(AUTH_JWT_KEY, data.jwt);
      }
      if (data.user) {
        await SecureStore.setItemAsync(AUTH_USER_KEY, JSON.stringify(data.user));
      }

      if (Platform.OS !== "web") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      Alert.alert(
        "Login Successful",
        `Welcome back, ${data.user?.name || data.user?.email || "User"}!`,
        [{ text: "Continue" }]
      );

    } catch (error: any) {
      console.error("[AuthDeepLink] Error:", error);
      
      if (Platform.OS !== "web") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }

      Alert.alert(
        "Login Failed",
        error.message || "Failed to complete sign-in. Please try again.",
        [{ text: "OK" }]
      );
    }
  }, []);

  const handleUrl = useCallback((url: string) => {
    console.log("[AuthDeepLink] Received URL:", url);

    try {
      const parsed = Linking.parse(url);
      
      if (parsed.path === "auth/callback" || parsed.hostname === "auth") {
        const code = parsed.queryParams?.code as string;
        if (code) {
          handleAuthCallback(code);
        }
      }
    } catch (error) {
      console.error("[AuthDeepLink] Parse error:", error);
    }
  }, [handleAuthCallback]);

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleUrl(url);
      }
    });

    const subscription = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => {
      subscription.remove();
    };
  }, [handleUrl]);

  return null;
}
