import { useState, useRef, useCallback, useEffect } from "react";
import { View, StyleSheet, Pressable, TextInput, Share, Alert, Platform, Linking, Modal, ActivityIndicator } from "react-native";
import { WebView, WebViewNavigation, WebViewMessageEvent } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as AuthSession from "expo-auth-session";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { useBrowserStore, getFaviconUrl, normalizeUrl } from "@/store/browserStore";
import { RootStackParamList } from "@/navigation/RootStackNavigator";
import { useExternalAuth, AuthStatus } from "@/context/ExternalAuthContext";
import { useWallet } from "@/lib/wallet-context";

const GOOGLE_DISCOVERY = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, "BrowserWebView">;

const BLOCKED_SCHEMES = ["javascript:", "file:", "data:", "about:"];

const CORDON_INJECTED_SCRIPT = `
(function() {
  if (window.cordon && window.cordon.isCordon) return;
  
  var platform = 'unknown';
  var ua = navigator.userAgent.toLowerCase();
  if (ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1) {
    platform = 'ios';
  } else if (ua.indexOf('android') > -1) {
    platform = 'android';
  }
  
  window.cordon = {
    version: '1.0.0',
    isCordon: true,
    isCordonBrowser: true,
    platform: platform,
    walletType: 'cordon',
    
    getWalletAddress: function() {
      return new Promise(function(resolve) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'cordon_getWalletAddress'
        }));
        window.__cordonResolvers = window.__cordonResolvers || {};
        window.__cordonResolvers.getWalletAddress = resolve;
      });
    },
    
    requestAuth: function(options) {
      return new Promise(function(resolve, reject) {
        var opts = options || {};
        opts.provider = opts.provider || 'google';
        
        console.log('[Cordon] requestAuth called with:', JSON.stringify(opts));
        
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'cordon_requestAuth',
          options: opts
        }));
        
        window.__cordonResolvers = window.__cordonResolvers || {};
        window.__cordonResolvers.requestAuth = { resolve: resolve, reject: reject };
      });
    },
    
    _receiveAuthResult: function(result) {
      console.log('[Cordon] Auth result received:', JSON.stringify(result));
      if (window.__cordonResolvers && window.__cordonResolvers.requestAuth) {
        window.__cordonResolvers.requestAuth.resolve(result);
        delete window.__cordonResolvers.requestAuth;
      }
    }
  };
  
  console.log('[Cordon] Bridge v1.0.0 injected - platform:', platform);
})();
true;
`;

const IGNORED_URL_PATTERNS = [
  /google\.com\/s2\/favicons/,
  /favicon\.ico$/,
  /\.png$/,
  /\.jpg$/,
  /\.gif$/,
  /\.svg$/,
  /\.css$/,
  /\.js$/,
];

function shouldRecordUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== "https:" && urlObj.protocol !== "http:") return false;
    for (const pattern of IGNORED_URL_PATTERNS) {
      if (pattern.test(url)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export default function BrowserWebViewScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { addRecent } = useBrowserStore();
  const webViewRef = useRef<WebView>(null);
  const externalAuth = useExternalAuth();
  const { activeWallet } = useWallet();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isAuthInProgress, setIsAuthInProgress] = useState(false);

  const walletAddress = activeWallet?.addresses?.evm || activeWallet?.address || null;

  const [currentUrl, setCurrentUrl] = useState(route.params.url);
  const [pageTitle, setPageTitle] = useState(route.params.title || "");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [urlInput, setUrlInput] = useState(route.params.url);
  const [isEditing, setIsEditing] = useState(false);

  const loadingProgress = useSharedValue(0);

  const progressStyle = useAnimatedStyle(() => ({
    width: `${loadingProgress.value * 100}%`,
    opacity: loadingProgress.value < 1 ? 1 : withTiming(0, { duration: 300 }),
  }));

  useEffect(() => {
    if (pageTitle && currentUrl && shouldRecordUrl(currentUrl)) {
      addRecent({
        url: currentUrl,
        title: pageTitle,
        favicon: getFaviconUrl(currentUrl),
      });
    }
  }, [pageTitle, currentUrl, addRecent]);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
    setCanGoForward(navState.canGoForward);
    if (navState.url) {
      setCurrentUrl(navState.url);
      setUrlInput(navState.url);
    }
    if (navState.title) {
      setPageTitle(navState.title);
    }
  }, []);

  const handleLoadStart = useCallback(() => {
    setIsLoading(true);
    loadingProgress.value = 0.1;
  }, [loadingProgress]);

  const handleLoadProgress = useCallback(
    ({ nativeEvent }: { nativeEvent: { progress: number } }) => {
      loadingProgress.value = nativeEvent.progress;
    },
    [loadingProgress]
  );

  const handleLoadEnd = useCallback(() => {
    setIsLoading(false);
    loadingProgress.value = 1;
  }, [loadingProgress]);

  const handleGoBack = useCallback(() => {
    if (canGoBack) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      webViewRef.current?.goBack();
    }
  }, [canGoBack]);

  const handleGoForward = useCallback(() => {
    if (canGoForward) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      webViewRef.current?.goForward();
    }
  }, [canGoForward]);

  const handleReload = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    webViewRef.current?.reload();
  }, []);

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
  }, [navigation]);

  const handleShare = useCallback(async () => {
    try {
      await Share.share({
        url: currentUrl,
        message: Platform.OS === "android" ? currentUrl : undefined,
      });
    } catch (error) {
      console.error("Share failed:", error);
    }
  }, [currentUrl]);

  const handleOpenExternal = useCallback(async () => {
    try {
      await Linking.openURL(currentUrl);
    } catch (error) {
      Alert.alert("Error", "Could not open in external browser");
    }
  }, [currentUrl]);

  const handleUrlSubmit = useCallback(() => {
    try {
      const normalizedUrl = normalizeUrl(urlInput);
      setCurrentUrl(normalizedUrl);
      setIsEditing(false);
    } catch (error: any) {
      Alert.alert("Invalid URL", error.message);
    }
  }, [urlInput]);

  const handleWebViewMessage = useCallback(async (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log("[BrowserWebView] Message received:", data.type);

      if (data.type === "cordon_getWalletAddress") {
        const response = { type: "cordon_walletAddress", address: walletAddress };
        webViewRef.current?.injectJavaScript(`
          if (window.__cordonResolvers && window.__cordonResolvers.getWalletAddress) {
            window.__cordonResolvers.getWalletAddress(${JSON.stringify(response)});
          }
          true;
        `);
      } else if (data.type === "cordon_requestAuth") {
        if (isAuthInProgress) {
          console.log("[BrowserWebView] Auth already in progress, ignoring");
          const errorResult = { ok: false, error: "Auth already in progress" };
          webViewRef.current?.injectJavaScript(`
            if (window.cordon && window.cordon._receiveAuthResult) {
              window.cordon._receiveAuthResult(${JSON.stringify(errorResult)});
            }
            true;
          `);
          return;
        }
        
        const options = data.options || {};
        const provider = options.provider || "google";
        
        console.log("[BrowserWebView] requestAuth for provider:", provider);
        
        if (provider !== "google") {
          const errorResult = { ok: false, error: `Provider '${provider}' not supported` };
          webViewRef.current?.injectJavaScript(`
            if (window.cordon && window.cordon._receiveAuthResult) {
              window.cordon._receiveAuthResult(${JSON.stringify(errorResult)});
            }
            true;
          `);
          return;
        }
        
        setIsAuthInProgress(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        
        try {
          const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";
          
          if (!clientId) {
            throw new Error("Google OAuth not configured. Please add EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.");
          }
          
          const redirectUri = AuthSession.makeRedirectUri({
            native: "cordon://auth/callback",
          });
          
          console.log("[BrowserWebView] ========== OAUTH DEBUG ==========");
          console.log("[BrowserWebView] Client ID:", clientId.substring(0, 20) + "...");
          console.log("[BrowserWebView] Redirect URI:", redirectUri);
          console.log("[BrowserWebView] Platform:", Platform.OS);
          console.log("[BrowserWebView] ================================");
          
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
          
          const authUrl = await request.makeAuthUrlAsync(GOOGLE_DISCOVERY);
          
          console.log("[BrowserWebView] Full Auth URL (check redirect_uri param):");
          console.log("[BrowserWebView]", authUrl);
          console.log("[BrowserWebView] Starting OAuth prompt...");
          
          const result = await request.promptAsync(GOOGLE_DISCOVERY);
          
          console.log("[BrowserWebView] OAuth result type:", result.type);
          
          if (result.type === "success" && result.params?.code) {
            const authResult = {
              ok: true,
              code: result.params.code,
              state: result.params.state || request.state,
            };
            
            console.log("[BrowserWebView] OAuth success, returning code to WebView");
            
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            
            webViewRef.current?.injectJavaScript(`
              if (window.cordon && window.cordon._receiveAuthResult) {
                window.cordon._receiveAuthResult(${JSON.stringify(authResult)});
              }
              true;
            `);
          } else if (result.type === "cancel" || result.type === "dismiss") {
            console.log("[BrowserWebView] OAuth cancelled by user");
            const authResult = { ok: false, error: "User cancelled" };
            webViewRef.current?.injectJavaScript(`
              if (window.cordon && window.cordon._receiveAuthResult) {
                window.cordon._receiveAuthResult(${JSON.stringify(authResult)});
              }
              true;
            `);
          } else {
            console.log("[BrowserWebView] ========== OAUTH ERROR ==========");
            console.log("[BrowserWebView] Result type:", result.type);
            console.log("[BrowserWebView] Full result:", JSON.stringify(result, null, 2));
            if (result.type === "error") {
              console.log("[BrowserWebView] Error code:", result.error?.code);
              console.log("[BrowserWebView] Error message:", result.error?.message);
              console.log("[BrowserWebView] Error description:", result.error?.description);
            }
            if ("params" in result && result.params) {
              console.log("[BrowserWebView] Params:", JSON.stringify(result.params));
            }
            console.log("[BrowserWebView] ================================");
            
            const errorMsg = result.type === "error" ? (result.error?.message || "OAuth error") : "Unknown error";
            const authResult = { ok: false, error: errorMsg };
            webViewRef.current?.injectJavaScript(`
              if (window.cordon && window.cordon._receiveAuthResult) {
                window.cordon._receiveAuthResult(${JSON.stringify(authResult)});
              }
              true;
            `);
          }
          
        } catch (error: any) {
          console.error("[BrowserWebView] Auth error:", error);
          
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          
          const authResult = { ok: false, error: error.message || "Authentication failed" };
          webViewRef.current?.injectJavaScript(`
            if (window.cordon && window.cordon._receiveAuthResult) {
              window.cordon._receiveAuthResult(${JSON.stringify(authResult)});
            }
            true;
          `);
        } finally {
          setIsAuthInProgress(false);
        }
      }
    } catch (error) {
      console.error("[BrowserWebView] Message parse error:", error);
    }
  }, [walletAddress, isAuthInProgress]);

  const handleShouldStartLoad = useCallback(
    (request: { url: string }) => {
      for (const scheme of BLOCKED_SCHEMES) {
        if (request.url.toLowerCase().startsWith(scheme)) {
          Alert.alert("Blocked", "This type of URL is not allowed for security reasons.");
          return false;
        }
      }

      if (externalAuth.isAuthTrigger(request.url)) {
        externalAuth.startAuth(request.url);
        return false;
      }

      return true;
    },
    [externalAuth]
  );

  useEffect(() => {
    if (externalAuth.status === "starting" || externalAuth.status === "pending" || externalAuth.status === "exchanging") {
      setShowAuthModal(true);
    } else if (externalAuth.status === "success" && externalAuth.completionUrl) {
      setShowAuthModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCurrentUrl(externalAuth.completionUrl);
      externalAuth.reset();
    } else if (externalAuth.status === "error") {
      setShowAuthModal(false);
      Alert.alert(
        "Sign-in Failed",
        externalAuth.error || "Something went wrong during authentication.",
        [
          { text: "Try Again", onPress: () => externalAuth.reset() },
          { text: "Open in Safari", onPress: handleOpenExternal },
          { text: "Cancel", style: "cancel", onPress: () => externalAuth.reset() },
        ]
      );
    }
  }, [externalAuth.status, externalAuth.completionUrl, externalAuth.error, handleOpenExternal, externalAuth]);

  const getAuthStatusMessage = (status: AuthStatus): { title: string; subtitle: string } => {
    switch (status) {
      case "starting":
        return { title: "Opening Secure Sign-in", subtitle: "Launching Google authentication..." };
      case "pending":
        return { title: "Complete Sign-in", subtitle: "Finish signing in through the secure browser window" };
      case "exchanging":
        return { title: "Signing You In", subtitle: "Completing authentication..." };
      default:
        return { title: "Authenticating", subtitle: "Please wait..." };
    }
  };

  const domain = (() => {
    try {
      return new URL(currentUrl).hostname;
    } catch {
      return currentUrl;
    }
  })();

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={handleClose} style={styles.headerButton} testID="close-browser">
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
          
          <Pressable
            style={[styles.urlBar, { backgroundColor: theme.backgroundRoot, borderColor: theme.border }]}
            onPress={() => setIsEditing(true)}
            testID="url-bar"
          >
            {isEditing ? (
              <TextInput
                style={[styles.urlInput, { color: theme.text }]}
                value={urlInput}
                onChangeText={setUrlInput}
                onSubmitEditing={handleUrlSubmit}
                onBlur={() => setIsEditing(false)}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
                selectTextOnFocus
                returnKeyType="go"
              />
            ) : (
              <>
                <Feather
                  name={currentUrl.startsWith("https") ? "lock" : "globe"}
                  size={14}
                  color={currentUrl.startsWith("https") ? theme.success : theme.textSecondary}
                />
                <ThemedText type="body" numberOfLines={1} style={styles.urlText}>
                  {domain}
                </ThemedText>
              </>
            )}
          </Pressable>
          
          <Pressable onPress={handleReload} style={styles.headerButton} testID="reload-button">
            <Feather name={isLoading ? "x" : "refresh-cw"} size={20} color={theme.text} />
          </Pressable>
        </View>

        <Animated.View
          style={[styles.progressBar, { backgroundColor: theme.accent }, progressStyle]}
        />
      </View>

      <WebView
        ref={webViewRef}
        source={{ uri: currentUrl }}
        style={styles.webview}
        onNavigationStateChange={handleNavigationStateChange}
        onLoadStart={handleLoadStart}
        onLoadProgress={handleLoadProgress}
        onLoadEnd={handleLoadEnd}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onMessage={handleWebViewMessage}
        injectedJavaScript={CORDON_INJECTED_SCRIPT}
        injectedJavaScriptBeforeContentLoaded={CORDON_INJECTED_SCRIPT}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        sharedCookiesEnabled
      />

      <View style={[styles.toolbar, { paddingBottom: insets.bottom, backgroundColor: theme.backgroundDefault }]}>
        <Pressable
          onPress={handleGoBack}
          style={[styles.toolbarButton, !canGoBack && styles.toolbarButtonDisabled]}
          disabled={!canGoBack}
          testID="back-button"
        >
          <Feather name="chevron-left" size={24} color={canGoBack ? theme.text : theme.textSecondary} />
        </Pressable>
        
        <Pressable
          onPress={handleGoForward}
          style={[styles.toolbarButton, !canGoForward && styles.toolbarButtonDisabled]}
          disabled={!canGoForward}
          testID="forward-button"
        >
          <Feather name="chevron-right" size={24} color={canGoForward ? theme.text : theme.textSecondary} />
        </Pressable>
        
        <Pressable onPress={handleShare} style={styles.toolbarButton} testID="share-button">
          <Feather name="share" size={22} color={theme.text} />
        </Pressable>
        
        <Pressable onPress={handleOpenExternal} style={styles.toolbarButton} testID="external-button">
          <Feather name="external-link" size={22} color={theme.text} />
        </Pressable>
      </View>

      <Modal
        visible={showAuthModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          externalAuth.reset();
          setShowAuthModal(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.authModal, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.authModalContent}>
              <View style={[styles.authIconContainer, { backgroundColor: theme.accent + "15" }]}>
                <Feather name="shield" size={32} color={theme.accent} />
              </View>
              <ThemedText type="h3" style={styles.authTitle}>
                {getAuthStatusMessage(externalAuth.status).title}
              </ThemedText>
              <ThemedText type="body" style={[styles.authSubtitle, { color: theme.textSecondary }]}>
                {getAuthStatusMessage(externalAuth.status).subtitle}
              </ThemedText>
              <ActivityIndicator size="large" color={theme.accent} style={styles.authSpinner} />
              <Pressable
                style={[styles.authCancelButton, { borderColor: theme.border }]}
                onPress={() => {
                  externalAuth.reset();
                  setShowAuthModal(false);
                }}
              >
                <ThemedText type="body" style={{ color: theme.textSecondary }}>
                  Cancel
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.1)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  headerButton: {
    padding: Spacing.sm,
  },
  urlBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  urlInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  urlText: {
    flex: 1,
  },
  progressBar: {
    height: 2,
    position: "absolute",
    bottom: 0,
    left: 0,
  },
  webview: {
    flex: 1,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.1)",
  },
  toolbarButton: {
    padding: Spacing.md,
  },
  toolbarButtonDisabled: {
    opacity: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  authModal: {
    width: "100%",
    maxWidth: 340,
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
  },
  authModalContent: {
    padding: Spacing["2xl"],
    alignItems: "center",
  },
  authIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  authTitle: {
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  authSubtitle: {
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  authSpinner: {
    marginBottom: Spacing.xl,
  },
  authCancelButton: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
  },
});
