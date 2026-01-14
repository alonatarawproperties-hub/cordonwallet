import { useState, useRef, useCallback, useEffect } from "react";
import { View, StyleSheet, Pressable, TextInput, Share, Alert, Platform, Linking, Modal, ActivityIndicator } from "react-native";
import { WebView, WebViewNavigation, WebViewMessageEvent } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";

WebBrowser.maybeCompleteAuthSession();

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { useBrowserStore, getFaviconUrl, normalizeUrl } from "@/store/browserStore";
import { RootStackParamList } from "@/navigation/RootStackNavigator";
import { useExternalAuth, AuthStatus } from "@/context/ExternalAuthContext";
import { useWallet } from "@/lib/wallet-context";
import { getApiUrl } from "@/lib/query-client";

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
  
  // Request ID counter for tracking async responses
  var requestId = 0;
  window.__cordonResolvers = window.__cordonResolvers || {};
  
  // Helper to send message and wait for response
  function sendRequest(type, data) {
    return new Promise(function(resolve, reject) {
      var id = ++requestId;
      window.__cordonResolvers['req_' + id] = { resolve: resolve, reject: reject };
      var msg = { type: type, requestId: id };
      for (var key in data) { if (data.hasOwnProperty(key)) msg[key] = data[key]; }
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    });
  }
  
  // Cordon core bridge
  window.cordon = {
    version: '1.0.0',
    isCordon: true,
    isCordonBrowser: true,
    platform: platform,
    walletType: 'cordon',
    
    getWalletAddress: function() {
      return sendRequest('cordon_getWalletAddress', {});
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
        window.__cordonResolvers.requestAuth = { resolve: resolve, reject: reject };
      });
    },
    
    _receiveAuthResult: function(result) {
      console.log('[Cordon] Auth result received:', JSON.stringify(result));
      if (window.__cordonResolvers && window.__cordonResolvers.requestAuth) {
        window.__cordonResolvers.requestAuth.resolve(result);
        delete window.__cordonResolvers.requestAuth;
      }
    },
    
    _handleResponse: function(requestId, result) {
      var key = 'req_' + requestId;
      if (window.__cordonResolvers[key]) {
        if (result.error) {
          window.__cordonResolvers[key].reject(new Error(result.error));
        } else {
          window.__cordonResolvers[key].resolve(result);
        }
        delete window.__cordonResolvers[key];
      }
    }
  };
  
  // ============================================
  // SOLANA PROVIDER (Phantom-compatible)
  // ============================================
  var solanaConnected = false;
  var solanaPublicKey = null;
  var solanaEventListeners = {};
  
  function SolanaPublicKey(base58) {
    this._base58 = base58;
    this._bytes = null;
    
    // Base58 decode for Solana public keys (always produces 32 bytes)
    var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    var BASE = 58;
    var PUBLIC_KEY_LENGTH = 32;
    try {
      var bytes = [];
      for (var i = 0; i < base58.length; i++) {
        var carry = ALPHABET.indexOf(base58[i]);
        if (carry < 0) throw new Error('Invalid base58 character');
        for (var j = 0; j < bytes.length; j++) {
          carry += bytes[j] * BASE;
          bytes[j] = carry & 0xff;
          carry >>= 8;
        }
        while (carry > 0) {
          bytes.push(carry & 0xff);
          carry >>= 8;
        }
      }
      for (var k = 0; k < base58.length && base58[k] === '1'; k++) {
        bytes.push(0);
      }
      bytes = bytes.reverse();
      // Pad or trim to exactly 32 bytes
      var result = new Uint8Array(PUBLIC_KEY_LENGTH);
      var offset = PUBLIC_KEY_LENGTH - bytes.length;
      if (offset > 0) {
        result.set(bytes, offset);
      } else {
        result.set(bytes.slice(-PUBLIC_KEY_LENGTH));
      }
      this._bytes = result;
    } catch (e) {
      this._bytes = new Uint8Array(PUBLIC_KEY_LENGTH);
    }
    
    this.toBase58 = function() { return this._base58; };
    this.toString = function() { return this._base58; };
    this.toJSON = function() { return this._base58; };
    this.toBytes = function() { return this._bytes; };
    this.equals = function(other) { 
      if (!other || !other.toBase58) return false;
      return this._base58 === other.toBase58(); 
    };
  }
  
  window.solana = {
    isPhantom: false,
    isCordon: true,
    
    get publicKey() {
      return solanaPublicKey;
    },
    
    get isConnected() {
      return solanaConnected;
    },
    
    connect: function(options) {
      console.log('[Cordon Solana] connect() called');
      return sendRequest('cordon_solana_connect', { options: options || {} })
        .then(function(result) {
          if (result.publicKey) {
            solanaPublicKey = new SolanaPublicKey(result.publicKey);
            solanaConnected = true;
            window.solana._emit('connect', solanaPublicKey);
            return { publicKey: solanaPublicKey };
          }
          throw new Error('Connection rejected');
        });
    },
    
    disconnect: function() {
      console.log('[Cordon Solana] disconnect() called');
      solanaConnected = false;
      solanaPublicKey = null;
      window.solana._emit('disconnect');
      return Promise.resolve();
    },
    
    signMessage: function(message, encoding) {
      console.log('[Cordon Solana] signMessage() called');
      if (!solanaConnected) return Promise.reject(new Error('Wallet not connected'));
      var msgArray = Array.from(message);
      return sendRequest('cordon_solana_signMessage', { 
        message: msgArray,
        encoding: encoding || 'utf8'
      }).then(function(result) {
        return { 
          signature: new Uint8Array(result.signature),
          publicKey: solanaPublicKey
        };
      });
    },
    
    signTransaction: function(transaction) {
      console.log('[Cordon Solana] signTransaction() called');
      if (!solanaConnected) return Promise.reject(new Error('Wallet not connected'));
      var serialized = Array.from(transaction.serialize({ requireAllSignatures: false }));
      return sendRequest('cordon_solana_signTransaction', { transaction: serialized })
        .then(function(result) {
          // Return an object that looks like a signed Transaction with serialize() method
          var signedBytes = new Uint8Array(result.signedTransaction);
          return {
            serialize: function(config) {
              return signedBytes;
            },
            signatures: result.signatures || [],
            _signedBytes: signedBytes
          };
        });
    },
    
    signAllTransactions: function(transactions) {
      console.log('[Cordon Solana] signAllTransactions() called');
      if (!solanaConnected) return Promise.reject(new Error('Wallet not connected'));
      return Promise.all(transactions.map(function(tx) {
        return window.solana.signTransaction(tx);
      }));
    },
    
    signAndSendTransaction: function(transaction, options) {
      console.log('[Cordon Solana] signAndSendTransaction() called');
      if (!solanaConnected) return Promise.reject(new Error('Wallet not connected'));
      var serialized = Array.from(transaction.serialize({ requireAllSignatures: false }));
      return sendRequest('cordon_solana_signAndSendTransaction', { 
        transaction: serialized,
        options: options || {}
      }).then(function(result) {
        return { signature: result.signature };
      });
    },
    
    on: function(event, callback) {
      if (!solanaEventListeners[event]) solanaEventListeners[event] = [];
      solanaEventListeners[event].push(callback);
    },
    
    off: function(event, callback) {
      if (!solanaEventListeners[event]) return;
      var idx = solanaEventListeners[event].indexOf(callback);
      if (idx > -1) solanaEventListeners[event].splice(idx, 1);
    },
    
    _emit: function(event, data) {
      if (!solanaEventListeners[event]) return;
      solanaEventListeners[event].forEach(function(cb) {
        try { cb(data); } catch(e) { console.error(e); }
      });
    },
    
    request: function(args) {
      var method = args.method;
      var params = args.params || {};
      console.log('[Cordon Solana] request:', method);
      
      if (method === 'connect') return window.solana.connect(params);
      if (method === 'disconnect') return window.solana.disconnect();
      if (method === 'signMessage') return window.solana.signMessage(params.message, params.display);
      if (method === 'signTransaction') return window.solana.signTransaction(params.transaction);
      if (method === 'signAndSendTransaction') return window.solana.signAndSendTransaction(params.transaction, params.options);
      
      return Promise.reject(new Error('Method not supported: ' + method));
    }
  };
  
  // Announce Solana wallet availability
  window.dispatchEvent(new Event('solana#initialized'));
  
  // ============================================
  // EVM PROVIDER (MetaMask-compatible)
  // ============================================
  var evmConnected = false;
  var evmAccounts = [];
  var evmChainId = '0x1'; // Default to Ethereum mainnet
  var evmEventListeners = {};
  
  window.ethereum = {
    isMetaMask: true,
    isCordon: true,
    
    get selectedAddress() {
      return evmAccounts[0] || null;
    },
    
    get chainId() {
      return evmChainId;
    },
    
    get networkVersion() {
      return String(parseInt(evmChainId, 16));
    },
    
    isConnected: function() {
      return evmConnected;
    },
    
    request: function(args) {
      var method = args.method;
      var params = args.params || [];
      console.log('[Cordon EVM] request:', method);
      
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
        if (evmConnected && evmAccounts.length > 0) {
          return Promise.resolve(evmAccounts);
        }
        return sendRequest('cordon_evm_connect', {})
          .then(function(result) {
            if (result.accounts && result.accounts.length > 0) {
              evmAccounts = result.accounts;
              evmChainId = result.chainId || '0x1';
              evmConnected = true;
              window.ethereum._emit('connect', { chainId: evmChainId });
              window.ethereum._emit('accountsChanged', evmAccounts);
              return evmAccounts;
            }
            throw new Error('Connection rejected');
          });
      }
      
      if (method === 'eth_chainId') {
        return Promise.resolve(evmChainId);
      }
      
      if (method === 'net_version') {
        return Promise.resolve(String(parseInt(evmChainId, 16)));
      }
      
      if (method === 'personal_sign' || method === 'eth_sign') {
        if (!evmConnected) return Promise.reject(new Error('Wallet not connected'));
        var message = params[0];
        var address = params[1];
        return sendRequest('cordon_evm_signMessage', { message: message, address: address });
      }
      
      if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData') {
        if (!evmConnected) return Promise.reject(new Error('Wallet not connected'));
        var address = params[0];
        var typedData = params[1];
        return sendRequest('cordon_evm_signTypedData', { address: address, typedData: typedData });
      }
      
      if (method === 'eth_sendTransaction') {
        if (!evmConnected) return Promise.reject(new Error('Wallet not connected'));
        var txParams = params[0];
        return sendRequest('cordon_evm_sendTransaction', { transaction: txParams });
      }
      
      if (method === 'wallet_switchEthereumChain') {
        var chainId = params[0].chainId;
        return sendRequest('cordon_evm_switchChain', { chainId: chainId })
          .then(function(result) {
            evmChainId = result.chainId;
            window.ethereum._emit('chainChanged', evmChainId);
            return null;
          });
      }
      
      if (method === 'wallet_addEthereumChain') {
        return Promise.reject(new Error('Adding custom chains not supported'));
      }
      
      console.log('[Cordon EVM] Unsupported method:', method);
      return Promise.reject(new Error('Method not supported: ' + method));
    },
    
    send: function(methodOrPayload, paramsOrCallback) {
      if (typeof methodOrPayload === 'string') {
        return window.ethereum.request({ method: methodOrPayload, params: paramsOrCallback || [] });
      }
      return window.ethereum.request(methodOrPayload);
    },
    
    sendAsync: function(payload, callback) {
      window.ethereum.request(payload)
        .then(function(result) { callback(null, { id: payload.id, jsonrpc: '2.0', result: result }); })
        .catch(function(error) { callback(error, null); });
    },
    
    enable: function() {
      return window.ethereum.request({ method: 'eth_requestAccounts' });
    },
    
    on: function(event, callback) {
      if (!evmEventListeners[event]) evmEventListeners[event] = [];
      evmEventListeners[event].push(callback);
    },
    
    removeListener: function(event, callback) {
      if (!evmEventListeners[event]) return;
      var idx = evmEventListeners[event].indexOf(callback);
      if (idx > -1) evmEventListeners[event].splice(idx, 1);
    },
    
    _emit: function(event, data) {
      if (!evmEventListeners[event]) return;
      evmEventListeners[event].forEach(function(cb) {
        try { cb(data); } catch(e) { console.error(e); }
      });
    }
  };
  
  // Announce EVM wallet availability
  window.dispatchEvent(new Event('ethereum#initialized'));
  
  console.log('[Cordon] Bridge v1.2.0 injected with Solana + EVM providers - platform:', platform);
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
        const response = { address: walletAddress };
        webViewRef.current?.injectJavaScript(`
          window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
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
          console.log("[BrowserWebView] ========== MOBILE OAUTH DEBUG ==========");
          console.log("[BrowserWebView] Using backend polling-based OAuth flow");
          console.log("[BrowserWebView] Platform:", Platform.OS);
          console.log("[BrowserWebView] ================================");
          
          // Use the centralized getApiUrl which handles dev vs production routing
          const apiBaseUrl = getApiUrl();
          console.log("[BrowserWebView] API Base URL:", apiBaseUrl);
          
          const startResponse = await fetch(`${apiBaseUrl}/api/auth/cordon/mobile/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          });
          
          if (!startResponse.ok) {
            throw new Error("Failed to start mobile auth session");
          }
          
          const { sessionId, authUrl } = await startResponse.json();
          console.log("[BrowserWebView] Session created:", sessionId);
          console.log("[BrowserWebView] Auth URL:", authUrl);
          
          const result = await WebBrowser.openAuthSessionAsync(authUrl, "cordon://");
          console.log("[BrowserWebView] WebBrowser result type:", result.type);
          
          // With polling-based OAuth, the browser will always return "cancel" or "dismiss"
          // when user closes it. We need to poll the backend to check if auth succeeded.
          console.log("[BrowserWebView] Browser closed, polling for auth result...");
          let attempts = 0;
          const maxAttempts = 10; // Quick poll for 10 seconds since user already saw "Login Successful"
          
          while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
            
            const pollResponse = await fetch(`${apiBaseUrl}/api/auth/cordon/mobile/poll?sessionId=${sessionId}`);
            const pollData = await pollResponse.json();
            
            console.log("[BrowserWebView] Poll attempt", attempts, "status:", pollData.status);
            
            if (pollData.status === "success") {
              // Return all available data. If idToken is present, Cordon already exchanged.
              // Roachy should check for idToken and use it directly instead of re-exchanging.
              // We include code for backward compatibility (Roachy checks if code exists).
              const authResult: Record<string, unknown> = {
                ok: true,
                provider: 'google',
              };
              
              // Always include code if available (Roachy checks for its existence)
              if (pollData.code) {
                authResult.code = pollData.code;
              }
              if (pollData.codeVerifier) {
                authResult.codeVerifier = pollData.codeVerifier;
              }
              
              // If Cordon exchanged the code, include the tokens and set exchangeComplete flag
              if (pollData.idToken) {
                authResult.idToken = pollData.idToken;
                authResult.accessToken = pollData.accessToken;
                authResult.exchangeComplete = true; // Signal: don't exchange code, use idToken
              }
              
              console.log("[BrowserWebView] OAuth success via polling!");
              console.log("[BrowserWebView] Has idToken:", !!pollData.idToken);
              console.log("[BrowserWebView] Response keys:", Object.keys(authResult).join(', '));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              
              webViewRef.current?.injectJavaScript(`
                if (window.cordon && window.cordon._receiveAuthResult) {
                  window.cordon._receiveAuthResult(${JSON.stringify(authResult)});
                }
                true;
              `);
              return;
            }
            
            if (pollData.status === "error") {
              throw new Error(pollData.error || "Authentication failed");
            }
            
            if (pollData.error) {
              throw new Error(pollData.error);
            }
          }
          
          // Only report "User cancelled" if polling found no success after all attempts
          console.log("[BrowserWebView] OAuth timed out or cancelled");
          const authResult = { ok: false, error: "User cancelled" };
          webViewRef.current?.injectJavaScript(`
            if (window.cordon && window.cordon._receiveAuthResult) {
              window.cordon._receiveAuthResult(${JSON.stringify(authResult)});
            }
            true;
          `);
          return;
          
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
      } else if (data.type === "cordon_solana_connect") {
        console.log("[BrowserWebView] Solana connect request");
        const solanaAddress = activeWallet?.addresses?.solana;
        
        if (!solanaAddress) {
          const response = { error: "No Solana wallet available" };
          webViewRef.current?.injectJavaScript(`
            window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
            true;
          `);
          return;
        }
        
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        
        const siteName = pageTitle || currentUrl;
        Alert.alert(
          "Connect Wallet",
          `${siteName} wants to connect to your Cordon wallet.`,
          [
            {
              text: "Deny",
              style: "cancel",
              onPress: () => {
                const response = { error: "User rejected connection" };
                webViewRef.current?.injectJavaScript(`
                  window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                  true;
                `);
              }
            },
            {
              text: "Connect",
              onPress: () => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                const response = { publicKey: solanaAddress };
                webViewRef.current?.injectJavaScript(`
                  window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                  true;
                `);
              }
            }
          ]
        );
      } else if (data.type === "cordon_solana_signMessage") {
        console.log("[BrowserWebView] Solana sign message request");
        const messageBytes = new Uint8Array(data.message);
        const messageText = new TextDecoder().decode(messageBytes);
        const siteName = pageTitle || currentUrl;
        const walletId = activeWallet?.id;
        
        if (!walletId) {
          const response = { error: "No wallet available" };
          webViewRef.current?.injectJavaScript(`
            window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
            true;
          `);
          return;
        }
        
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        
        Alert.alert(
          "Sign Message",
          `${siteName} wants you to sign:\n\n"${messageText.slice(0, 100)}${messageText.length > 100 ? '...' : ''}"`,
          [
            {
              text: "Reject",
              style: "cancel",
              onPress: () => {
                const response = { error: "User rejected signing" };
                webViewRef.current?.injectJavaScript(`
                  window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                  true;
                `);
              }
            },
            {
              text: "Sign",
              onPress: async () => {
                try {
                  const { signSolanaMessage } = await import("@/lib/blockchain/transactions");
                  const bs58 = await import("bs58");
                  const signatureBase58 = await signSolanaMessage({ walletId: walletId!, message: messageText });
                  const signatureBytes = bs58.default.decode(signatureBase58);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  const solanaAddress = activeWallet?.addresses?.solana;
                  const response = { signature: Array.from(signatureBytes), publicKey: solanaAddress };
                  webViewRef.current?.injectJavaScript(`
                    window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                    true;
                  `);
                } catch (error: any) {
                  const response = { error: error.message || "Signing failed" };
                  webViewRef.current?.injectJavaScript(`
                    window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                    true;
                  `);
                }
              }
            }
          ]
        );
      } else if (data.type === "cordon_solana_signTransaction" || data.type === "cordon_solana_signAndSendTransaction") {
        console.log("[BrowserWebView] Solana sign transaction request");
        const siteName = pageTitle || currentUrl;
        const walletId = activeWallet?.id;
        
        if (!walletId) {
          const response = { error: "No wallet available" };
          webViewRef.current?.injectJavaScript(`
            window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
            true;
          `);
          return;
        }
        
        const txBytes = new Uint8Array(data.transaction);
        const txBase64 = btoa(String.fromCharCode(...txBytes));
        
        const { decodeSolanaTransaction } = await import("@/lib/solana/decoder");
        const decoded = decodeSolanaTransaction(txBase64);
        
        if (decoded.drainerDetection?.isBlocked) {
          console.warn("[BrowserWebView] DRAINER BLOCKED:", decoded.drainerDetection.attackType);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert(
            "Wallet Drainer Blocked",
            decoded.drainerDetection.attackType === "SetAuthority"
              ? "This transaction tries to change your token account ownership. If signed, an attacker would gain permanent control of your tokens.\n\nCordon has blocked this transaction for your protection."
              : "This transaction tries to reassign your wallet to a malicious program. If signed, you would permanently lose access to your funds.\n\nCordon has blocked this transaction for your protection.",
            [{ text: "OK", style: "cancel" }]
          );
          const response = { error: "Transaction blocked: Wallet drainer detected" };
          webViewRef.current?.injectJavaScript(`
            window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
            true;
          `);
          return;
        }
        
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        
        Alert.alert(
          "Sign Transaction",
          `${siteName} wants you to sign a Solana transaction.`,
          [
            {
              text: "Reject",
              style: "cancel",
              onPress: () => {
                const response = { error: "User rejected transaction" };
                webViewRef.current?.injectJavaScript(`
                  window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                  true;
                `);
              }
            },
            {
              text: "Sign",
              onPress: async () => {
                try {
                  const { signSolanaTransaction } = await import("@/lib/blockchain/transactions");
                  const txBytes = new Uint8Array(data.transaction);
                  const txBase64 = btoa(String.fromCharCode(...txBytes));
                  const signedTxBase64 = await signSolanaTransaction({ walletId: walletId!, transaction: txBase64 });
                  
                  if (data.type === "cordon_solana_signAndSendTransaction") {
                    const apiUrl = getApiUrl();
                    const sendUrl = new URL("/api/solana/send-signed-transaction", apiUrl);
                    const sendResponse = await fetch(sendUrl.toString(), {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ transactionBase64: signedTxBase64 }),
                    });
                    const sendResult = await sendResponse.json();
                    if (sendResult.error) {
                      throw new Error(sendResult.error);
                    }
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    const response = { signature: sendResult.signature };
                    webViewRef.current?.injectJavaScript(`
                      window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                      true;
                    `);
                  } else {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    const signedBytes = atob(signedTxBase64).split('').map(c => c.charCodeAt(0));
                    const response = { signedTransaction: signedBytes };
                    webViewRef.current?.injectJavaScript(`
                      window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                      true;
                    `);
                  }
                } catch (error: any) {
                  const response = { error: error.message || "Transaction failed" };
                  webViewRef.current?.injectJavaScript(`
                    window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                    true;
                  `);
                }
              }
            }
          ]
        );
      } else if (data.type === "cordon_evm_connect") {
        console.log("[BrowserWebView] EVM connect request");
        const evmAddress = activeWallet?.addresses?.evm;
        
        if (!evmAddress) {
          const response = { error: "No EVM wallet available" };
          webViewRef.current?.injectJavaScript(`
            window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
            true;
          `);
          return;
        }
        
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const siteName = pageTitle || currentUrl;
        
        Alert.alert(
          "Connect Wallet",
          `${siteName} wants to connect to your Cordon wallet.`,
          [
            {
              text: "Deny",
              style: "cancel",
              onPress: () => {
                const response = { error: "User rejected connection" };
                webViewRef.current?.injectJavaScript(`
                  window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                  true;
                `);
              }
            },
            {
              text: "Connect",
              onPress: () => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                const response = { accounts: [evmAddress], chainId: "0x89" };
                webViewRef.current?.injectJavaScript(`
                  window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                  true;
                `);
              }
            }
          ]
        );
      } else if (data.type === "cordon_evm_signMessage") {
        console.log("[BrowserWebView] EVM sign message request");
        const siteName = pageTitle || currentUrl;
        const walletId = activeWallet?.id;
        
        if (!walletId) {
          const response = { error: "No wallet available" };
          webViewRef.current?.injectJavaScript(`
            window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
            true;
          `);
          return;
        }
        
        let messageText = data.message;
        if (messageText.startsWith("0x")) {
          try {
            const bytes = [];
            for (let i = 2; i < messageText.length; i += 2) {
              bytes.push(parseInt(messageText.substr(i, 2), 16));
            }
            messageText = new TextDecoder().decode(new Uint8Array(bytes));
          } catch { }
        }
        
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        
        Alert.alert(
          "Sign Message",
          `${siteName} wants you to sign:\n\n"${messageText.slice(0, 100)}${messageText.length > 100 ? '...' : ''}"`,
          [
            {
              text: "Reject",
              style: "cancel",
              onPress: () => {
                const response = { error: "User rejected signing" };
                webViewRef.current?.injectJavaScript(`
                  window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                  true;
                `);
              }
            },
            {
              text: "Sign",
              onPress: async () => {
                try {
                  const { signPersonalMessage } = await import("@/lib/blockchain/transactions");
                  const signature = await signPersonalMessage({ walletId: walletId!, message: data.message });
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  webViewRef.current?.injectJavaScript(`
                    window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(signature)});
                    true;
                  `);
                } catch (error: any) {
                  const response = { error: error.message || "Signing failed" };
                  webViewRef.current?.injectJavaScript(`
                    window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                    true;
                  `);
                }
              }
            }
          ]
        );
      } else if (data.type === "cordon_evm_sendTransaction") {
        console.log("[BrowserWebView] EVM send transaction request");
        const siteName = pageTitle || currentUrl;
        const walletId = activeWallet?.id;
        
        if (!walletId) {
          const response = { error: "No wallet available" };
          webViewRef.current?.injectJavaScript(`
            window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
            true;
          `);
          return;
        }
        
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const tx = data.transaction;
        
        Alert.alert(
          "Send Transaction",
          `${siteName} wants to send a transaction${tx.value ? ` of ${parseInt(tx.value, 16) / 1e18} ETH` : ''}.`,
          [
            {
              text: "Reject",
              style: "cancel",
              onPress: () => {
                const response = { error: "User rejected transaction" };
                webViewRef.current?.injectJavaScript(`
                  window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                  true;
                `);
              }
            },
            {
              text: "Send",
              onPress: async () => {
                try {
                  const { sendRawTransaction } = await import("@/lib/blockchain/transactions");
                  const result = await sendRawTransaction({
                    walletId: walletId!,
                    chainId: 137,
                    to: tx.to,
                    data: tx.data || "0x",
                    value: tx.value ? BigInt(tx.value) : 0n,
                  });
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  webViewRef.current?.injectJavaScript(`
                    window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(result.hash)});
                    true;
                  `);
                } catch (error: any) {
                  const response = { error: error.message || "Transaction failed" };
                  webViewRef.current?.injectJavaScript(`
                    window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                    true;
                  `);
                }
              }
            }
          ]
        );
      } else if (data.type === "cordon_evm_switchChain") {
        console.log("[BrowserWebView] EVM switch chain request");
        const response = { chainId: data.chainId };
        webViewRef.current?.injectJavaScript(`
          window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
          true;
        `);
      } else if (data.type === "cordon_evm_signTypedData") {
        console.log("[BrowserWebView] EVM signTypedData request");
        const siteName = pageTitle || currentUrl;
        const walletId = activeWallet?.id;
        
        if (!walletId) {
          const response = { error: "No wallet available" };
          webViewRef.current?.injectJavaScript(`
            window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
            true;
          `);
          return;
        }
        
        let domainName = "Unknown dApp";
        try {
          const typedData = JSON.parse(data.typedData);
          if (typedData.domain?.name) {
            domainName = typedData.domain.name;
          }
        } catch {}
        
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        
        Alert.alert(
          "Sign Typed Data",
          `${siteName} (${domainName}) wants you to sign structured data.`,
          [
            {
              text: "Reject",
              style: "cancel",
              onPress: () => {
                const response = { error: "User rejected signing" };
                webViewRef.current?.injectJavaScript(`
                  window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                  true;
                `);
              }
            },
            {
              text: "Sign",
              onPress: async () => {
                try {
                  const { signTypedData } = await import("@/lib/blockchain/transactions");
                  const typedData = JSON.parse(data.typedData);
                  const signature = await signTypedData({ walletId: walletId!, typedData });
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  webViewRef.current?.injectJavaScript(`
                    window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(signature)});
                    true;
                  `);
                } catch (error: any) {
                  const response = { error: error.message || "Signing failed" };
                  webViewRef.current?.injectJavaScript(`
                    window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
                    true;
                  `);
                }
              }
            }
          ]
        );
      }
    } catch (error) {
      console.error("[BrowserWebView] Message parse error:", error);
    }
  }, [walletAddress, isAuthInProgress, activeWallet, pageTitle, currentUrl]);

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
