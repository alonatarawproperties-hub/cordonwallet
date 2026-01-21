import { useState, useRef, useCallback, useEffect } from "react";
import { View, StyleSheet, Pressable, TextInput, Share, Alert, Platform, Linking, Modal, ActivityIndicator, Text } from "react-native";
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
import { useWalletConnect } from "@/lib/walletconnect/context";
import { getApiUrl } from "@/lib/query-client";
import { BrowserConnectSheet } from "@/components/BrowserConnectSheet";
import { BrowserSignSheet } from "@/components/BrowserSignSheet";

function extractWalletConnectUri(input: string): string | null {
  if (!input) return null;
  let s = input.trim();

  // Handle walletconnect: scheme - normalize to wc:
  if (s.startsWith("walletconnect:")) {
    return "wc:" + s.slice("walletconnect:".length);
  }

  // Direct wc: URI
  if (s.startsWith("wc:")) return s;

  // If it's a URL like https://...?uri=wc%3A.... or wc?uri=...
  try {
    if (s.startsWith("http://") || s.startsWith("https://")) {
      const u = new URL(s);
      const uriParam = u.searchParams.get("uri") || u.searchParams.get("wc");
      if (uriParam) s = uriParam;
    }
  } catch {}

  // Handle "wc?uri=..." fragments or "uri=wc%3A..."
  if (s.includes("uri=")) {
    const idx = s.indexOf("uri=");
    s = s.slice(idx + 4);
    // cut off extra params
    const amp = s.indexOf("&");
    if (amp !== -1) s = s.slice(0, amp);
  }

  // Decode if encoded
  try { s = decodeURIComponent(s); } catch {}

  // Normalize walletconnect: to wc:
  if (s.startsWith("walletconnect:")) {
    s = "wc:" + s.slice("walletconnect:".length);
  }

  // Accept only wc:
  if (s.startsWith("wc:")) return s;

  // Sometimes the wc: appears inside a longer string
  const wcIndex = s.indexOf("wc:");
  if (wcIndex !== -1) {
    const candidate = s.slice(wcIndex);
    if (candidate.startsWith("wc:")) return candidate;
  }

  return null;
}

const GOOGLE_DISCOVERY = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, "BrowserWebView">;

// URL blocking disabled - all dApps are trusted in the curated browser

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

const WALLETCONNECT_CAPTURE_SCRIPT = `
(function() {
  if (window.__cordonWcCapture) return;
  window.__cordonWcCapture = true;

  try {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "WC_CAPTURE_READY" }));
    }
  } catch (e) {}

  var lastPostedUri = '';
  var lastPostTime = 0;
  var autoClickedWc = false;

  // Burst scan globals
  var burstTimer = null;
  var burstEndsAt = 0;

  function decodeMaybe(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
  }

  function deepScanForWcUri() {
    scanStorage();
    scanForQrUri();
  }

  function startBurstScan(ms) {
    burstEndsAt = Date.now() + ms;
    if (burstTimer) return;
    console.log('[Cordon] burst scan start');
    burstTimer = setInterval(function() {
      deepScanForWcUri();
      if (Date.now() > burstEndsAt) {
        console.log('[Cordon] burst scan stop');
        clearInterval(burstTimer);
        burstTimer = null;
      }
    }, 250);
  }

  // Hook Storage.prototype.setItem with comprehensive extraction
  try {
    var origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, v) {
      try {
        var sKey = (k ?? '').toString();
        var sVal = (v ?? '').toString();
        var uri = extractWcFromText(sVal) || extractWcFromText(sKey);
        if (!uri) {
          var dv = decodeMaybe(sVal);
          uri = extractWcFromText(dv);
        }
        if (!uri && (sVal.startsWith('{') || sVal.startsWith('['))) {
          try {
            var obj = JSON.parse(sVal);
            var str = JSON.stringify(obj);
            uri = extractWcFromText(str) || extractWcFromText(decodeMaybe(str));
          } catch (e) {}
        }
        if (uri) {
          console.log('[Cordon] setItem captured wc uri');
          postWc(uri);
        }
      } catch (e) {}
      return origSetItem.apply(this, arguments);
    };
  } catch (e) {
    try {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage("WC_SELFTEST_SETITEM_HOOK_FAILED");
      }
    } catch (_) {}
  }

  // Self-test setItem hook
  try {
    localStorage.setItem("__cordon_wc_selftest", "wc:TEST@2?relay-protocol=irn&symKey=abc");
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage("WC_SELFTEST_SETITEM_CALLED");
    }
  } catch (e) {
    try {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage("WC_SELFTEST_SETITEM_CALL_FAILED");
      }
    } catch (_) {}
  }

  // Listen for storage events from other tabs/contexts
  try {
    window.addEventListener('storage', function() { try { scanStorage(); } catch(e) {} });
  } catch (e) {}

  function postConnecting(reason) {
    try {
      if (!window.ReactNativeWebView) return;
      var now = Date.now();
      if (window.__cordonLastConn && (now - window.__cordonLastConn) < 1200) return;
      window.__cordonLastConn = now;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'WC_CONNECTING', reason: reason || 'unknown' }));
    } catch (e) {}
  }

  function postWc(uri) {
    try {
      if (!window.ReactNativeWebView || typeof uri !== 'string') return;
      if (!uri.startsWith('wc:') && !uri.startsWith('walletconnect:') && !uri.includes('wc:')) return;
      
      // Sanitize walletconnect: scheme to wc:
      var cleanUri = uri;
      if (uri.startsWith('walletconnect:')) {
        var wcIdx = uri.indexOf('wc:');
        if (wcIdx !== -1) {
          cleanUri = uri.substring(wcIdx);
        }
      }
      
      var now = Date.now();
      if (cleanUri === lastPostedUri && now - lastPostTime < 2000) return;
      lastPostedUri = cleanUri;
      lastPostTime = now;
      
      console.log('[Cordon] Posting WC URI:', cleanUri.substring(0, 80));
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'WC_URI', uri: cleanUri }));
    } catch (e) { console.log('[Cordon] postWc error:', e); }
  }

  function extractWcFromText(text) {
    if (!text || typeof text !== 'string') return null;
    var idx = text.indexOf('wc:');
    if (idx === -1) idx = text.indexOf('walletconnect:');
    if (idx === -1) return null;
    var result = text.substring(idx);
    var end = result.indexOf(' ');
    if (end !== -1) result = result.substring(0, end);
    return result;
  }

  // Scan localStorage/sessionStorage for WC pairing URIs
  function scanStorage() {
    try {
      [localStorage, sessionStorage].forEach(function(storage) {
        if (!storage) return;
        for (var i = 0; i < storage.length; i++) {
          var key = storage.key(i);
          if (!key) continue;
          // Look for WalletConnect related keys
          if (key.includes('wc@') || key.includes('walletconnect') || key.includes('w3m') || key.includes('WALLETCONNECT') || key.includes('reown')) {
            try {
              var val = storage.getItem(key);
              if (val) {
                var wc = extractWcFromText(val);
                if (wc) { postWc(wc); return; }
                // Try parsing JSON
                try {
                  var obj = JSON.parse(val);
                  var str = JSON.stringify(obj);
                  wc = extractWcFromText(str);
                  if (wc) { postWc(wc); return; }
                } catch (e) {}
              }
            } catch (e) {}
          }
        }
      });
    } catch (e) {}
  }

  // Scan for QR code URI in the page
  function scanForQrUri() {
    try {
      // Look for QR code containers and extract URI
      var qrContainers = document.querySelectorAll('w3m-qrcode, wcm-qrcode, [class*="qr"], [class*="QR"], canvas, svg');
      qrContainers.forEach(function(el) {
        // Check for data attributes containing WC URI
        if (el.dataset) {
          Object.values(el.dataset).forEach(function(val) {
            var wc = extractWcFromText(val);
            if (wc) postWc(wc);
          });
        }
        // Check parent/sibling elements for URI
        var parent = el.parentElement;
        if (parent) {
          var text = parent.textContent || '';
          if (text.includes('wc:')) {
            var wc = extractWcFromText(text);
            if (wc) postWc(wc);
          }
        }
      });
      
      // Also check for copy buttons near QR codes
      var copyBtns = document.querySelectorAll('[aria-label*="copy" i], [title*="copy" i], button[class*="copy" i]');
      copyBtns.forEach(function(btn) {
        if (btn.dataset && btn.dataset.clipboardText) {
          var wc = extractWcFromText(btn.dataset.clipboardText);
          if (wc) postWc(wc);
        }
      });
    } catch (e) {}
  }

  // Auto-click disabled to prevent false loader triggers
  function autoClickWalletConnect(container) {
    return false;
  }

  // Scan modal containers for WC URIs
  function scanContainer(container) {
    if (!container) return;
    try {
      // First try to auto-click WalletConnect
      autoClickWalletConnect(container);
      
      var inputs = container.querySelectorAll('input');
      inputs.forEach(function(inp) {
        var wc = extractWcFromText(inp.value);
        if (wc) postWc(wc);
      });
      var allEls = container.querySelectorAll('*');
      allEls.forEach(function(el) {
        if (!el.getAttribute) return;
        var attrs = el.attributes;
        for (var i = 0; i < attrs.length; i++) {
          var wc = extractWcFromText(attrs[i].value);
          if (wc) { postWc(wc); return; }
        }
      });
    } catch (e) {}
    scanStorage();
  }

  // MutationObserver for modal detection
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (!node || node.nodeType !== 1) return;
        try {
          var tagName = (node.tagName || '').toLowerCase();
          var nodeText = (node.textContent || '').toLowerCase();
          
          // Detect QR code screen specifically - start burst scan
          var isQrScreen = nodeText.includes('qr code') || nodeText.includes('scan this') || 
                           nodeText.includes('copy link') || nodeText.includes('scan with');
          if (isQrScreen) {
            console.log('[Cordon] QR screen detected');
            postConnecting('qr_screen');
            startBurstScan(8000);
            setTimeout(function(){ autoClickCopyLink(node); }, 50);
            setTimeout(function(){ autoClickCopyLink(document); }, 200);
          }
          
          // Detect Web3Modal/AppKit/Reown modals
          if (tagName === 'w3m-modal' || tagName === 'wcm-modal' || tagName === 'appkit-modal' ||
              tagName.includes('w3m-') || tagName.includes('wcm-') || tagName.includes('appkit-')) {
            console.log('[Cordon] Modal detected:', tagName);
            postConnecting('modal');
            startBurstScan(8000);
            scanContainer(node);
          }
          // Only trigger for specific WC modal class names (not generic 'wallet' or 'connect')
          if (node.className && typeof node.className === 'string') {
            var cn = node.className.toLowerCase();
            if (cn.includes('w3m') || cn.includes('wcm') || cn.includes('appkit')) {
              startBurstScan(8000);
              scanContainer(node);
            }
          }
        } catch (e) {}
      });
    });
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // Hook clipboard writeText
  try {
    var clip = navigator.clipboard;
    if (clip && clip.writeText) {
      var origWriteText = clip.writeText.bind(clip);
      clip.writeText = function(text) {
        var wc = extractWcFromText(text);
        if (wc) postWc(wc);
        return origWriteText(text);
      };
    }
  } catch (e) {}

  // Hook window.open - critical for deep links
  var originalOpen = window.open;
  window.open = function(url) {
    try {
      if (typeof url === 'string') {
        console.log('[Cordon] window.open:', url.substring(0, 80));
        var wc = extractWcFromText(url);
        if (wc) { postWc(wc); return null; }
        // Check for wallet deep links that might contain WC URI as param
        if (url.includes('wc=') || url.includes('uri=') || url.startsWith('walletconnect://') || url.includes('walletconnect://wc')) {
          try {
            var u = new URL(url);
            var wcParam = u.searchParams.get('uri') || u.searchParams.get('wc') || u.searchParams.get('request');
            if (wcParam) {
              var decoded = decodeURIComponent(wcParam);
              wc = extractWcFromText(decoded);
              if (wc) { postWc(wc); return null; }
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return originalOpen.apply(window, arguments);
  };

  // Hook Linking/deep link attempts via setting location
  var locDesc = Object.getOwnPropertyDescriptor(window, 'location');
  if (locDesc && locDesc.set) {
    var origSet = locDesc.set;
    Object.defineProperty(window, 'location', {
      get: locDesc.get,
      set: function(val) {
        try {
          if (typeof val === 'string') {
            console.log('[Cordon] location set:', val.substring(0, 80));
            var wc = extractWcFromText(val);
            if (wc) { postWc(wc); return; }
          }
        } catch (e) {}
        return origSet.call(window, val);
      },
      configurable: true
    });
  }

  // Hook location.assign
  var originalAssign = window.location.assign.bind(window.location);
  window.location.assign = function(url) {
    try {
      var wc = extractWcFromText(url);
      if (wc) { postWc(wc); return; }
    } catch (e) {}
    return originalAssign(url);
  };

  // Hook location.replace
  var originalReplace = window.location.replace.bind(window.location);
  window.location.replace = function(url) {
    try {
      var wc = extractWcFromText(url);
      if (wc) { postWc(wc); return; }
    } catch (e) {}
    return originalReplace(url);
  };

  // Hook anchor clicks
  document.addEventListener('click', function(e) {
    try {
      var target = e.target;
      if (!target) return;
      
      // Check if clicked element or parent has WC data
      var el = target.closest ? target.closest('a, button, [role="button"]') : target;
      if (el) scanElement(el);
      
      // Check anchor hrefs
      var a = target.closest ? target.closest('a') : null;
      if (a) {
        var href = a.getAttribute('href') || '';
        var wc = extractWcFromText(href);
        if (wc) {
          e.preventDefault();
          postWc(wc);
        }
      }
    } catch (e) {}
  }, true);

  // Intercept Web3Modal/WalletConnect signaling via fetch
  try {
    var origFetch = window.fetch;
    window.fetch = function(url, options) {
      try {
        if (typeof url === 'string' && (url.includes('relay.walletconnect.') || url.includes('walletconnect.org') || url.includes('walletconnect.com'))) {
          console.log('[Cordon] WC relay fetch detected');
          setTimeout(function() { scanStorage(); }, 100);
          setTimeout(function() { scanStorage(); }, 500);
        }
      } catch (e) {}
      return origFetch.apply(window, arguments);
    };
  } catch (e) {}

  // Deep scan for WC URI - check all storage keys and DOM
  function deepScanForWcUri() {
    scanStorage();
    scanForQrUri();
    
    // Scan ALL localStorage keys for any wc: URI
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        var val = localStorage.getItem(key);
        if (val && val.includes('wc:')) {
          var wc = extractWcFromText(val);
          if (wc) { postWc(wc); return; }
        }
      }
    } catch (e) {}
    
    // Scan sessionStorage too
    try {
      for (var j = 0; j < sessionStorage.length; j++) {
        var skey = sessionStorage.key(j);
        var sval = sessionStorage.getItem(skey);
        if (sval && sval.includes('wc:')) {
          var swc = extractWcFromText(sval);
          if (swc) { postWc(swc); return; }
        }
      }
    } catch (e) {}
    
    // Check for any element with wc: in attributes
    try {
      var allEls = document.querySelectorAll('*');
      for (var k = 0; k < Math.min(allEls.length, 500); k++) {
        var elem = allEls[k];
        if (!elem.attributes) continue;
        for (var m = 0; m < elem.attributes.length; m++) {
          var attrVal = elem.attributes[m].value;
          if (attrVal && attrVal.includes('wc:')) {
            var awc = extractWcFromText(attrVal);
            if (awc) { postWc(awc); return; }
          }
        }
      }
    } catch (e) {}
  }

  // Aggressive click handler - scan storage after any wallet/connect button click
  document.addEventListener('click', function(e) {
    try {
      var target = e.target;
      if (!target) return;
      
      // Get clicked element and check parents
      var el = target.closest ? (target.closest('button, [role="button"], a, li, div[onclick], span') || target) : target;
      var text = (el.textContent || '').toLowerCase().trim();
      var className = ((el.className && typeof el.className === 'string') ? el.className : '').toLowerCase();
      
      // Check if any parent has WalletConnect text/image
      var parent = el;
      var isWcButton = false;
      for (var depth = 0; depth < 5 && parent; depth++) {
        var pText = (parent.textContent || '').toLowerCase();
        var pClass = ((parent.className && typeof parent.className === 'string') ? parent.className : '').toLowerCase();
        var hasWcImg = parent.querySelector && parent.querySelector('img[alt*="WalletConnect" i], img[src*="walletconnect" i], [src*="walletconnect" i]');
        
        if (
          (pText && pText.trim() === 'walletconnect') ||
          (pText && pText.trim().startsWith('walletconnect')) ||
          (pClass && pClass.includes('walletconnect')) ||
          !!hasWcImg
        ) {
          isWcButton = true;
          break;
        }
        parent = parent.parentElement;
      }
      
      if (isWcButton) {
        console.log('[Cordon] WalletConnect clicked - starting burst scan');
        postConnecting('wc_click');
        startBurstScan(8000);
        return;
      }
    } catch (e) {}
  }, true);

  // Intercept WebSocket for WC relay
  try {
    var OrigWS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      try {
        if (typeof url === 'string' && (url.includes('relay.walletconnect') || url.includes('walletconnect.org'))) {
          console.log('[Cordon] WC WebSocket detected');
          setTimeout(function() { scanStorage(); }, 500);
          setTimeout(function() { scanStorage(); }, 2000);
        }
      } catch (e) {}
      return protocols ? new OrigWS(url, protocols) : new OrigWS(url);
    };
    window.WebSocket.prototype = OrigWS.prototype;
    window.WebSocket.CONNECTING = OrigWS.CONNECTING;
    window.WebSocket.OPEN = OrigWS.OPEN;
    window.WebSocket.CLOSING = OrigWS.CLOSING;
    window.WebSocket.CLOSED = OrigWS.CLOSED;
  } catch (e) {}

  // Listen to storage events (some libs trigger it)
  try {
    window.addEventListener('storage', function(ev) {
      try {
        if (ev && ev.newValue && typeof ev.newValue === 'string') {
          var wc = extractWcFromText(ev.newValue);
          if (wc) postWc(wc);
        }
      } catch (e) {}
    });
  } catch (e) {}

  // Helper to extract WC from any object/string
  function tryExtractAny(obj) {
    try {
      if (!obj) return null;
      if (typeof obj === "string") return extractWcFromText(obj);
      return extractWcFromText(JSON.stringify(obj));
    } catch (e) { return null; }
  }

  // Capture from window message events (Web3Modal frequently posts the uri)
  try {
    window.addEventListener("message", function(ev) {
      try {
        var wc = tryExtractAny(ev && ev.data);
        if (wc) postWc(wc);
      } catch (e) {}
    }, true);
  } catch (e) {}

  // Hook postMessage itself (some libs call window.postMessage directly)
  try {
    var origPm = window.postMessage;
    window.postMessage = function(data) {
      try {
        var wc = tryExtractAny(data);
        if (wc) postWc(wc);
      } catch (e) {}
      return origPm.apply(this, arguments);
    };
  } catch (e) {}

  // Auto-click "Copy link" button when QR screen shows
  function autoClickCopyLink(root) {
    try {
      var r = root || document;
      var els = r.querySelectorAll("button, [role='button'], a, div");
      for (var i=0;i<els.length;i++){
        var t = (els[i].textContent || "").toLowerCase().trim();
        if (t === "copy link" || t === "copy" || t.includes("copy link")) {
          console.log("[Cordon] Auto-clicking Copy link");
          els[i].click();
          return true;
        }
      }
    } catch(e) {}
    return false;
  }

  // Initial burst scan after page load
  setTimeout(function(){ startBurstScan(2500); }, 200);

  console.log('[Cordon] WalletConnect capture v7 injected');
})();
true;
`;

const COMBINED_INJECTED_SCRIPT_BODY = CORDON_INJECTED_SCRIPT + WALLETCONNECT_CAPTURE_SCRIPT;

const COMBINED_INJECTED_SCRIPT = `
(function(){
  try {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage("INJECT_BEFORE_START");
    }
  } catch(e) {}
  try {
    ${COMBINED_INJECTED_SCRIPT_BODY}
  } catch (e) {
    try {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: "INJECT_ERROR",
          message: String(e),
          stack: e && e.stack ? String(e.stack) : ""
        }));
      }
    } catch(_) {}
  }
  try {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage("INJECT_AFTER_END");
    }
  } catch(e) {}
})();
true;
`;

const DEBUG_BOOT_SCRIPT = `
  (function(){
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage("DEBUG_BOOT: " + location.href);
      }
    } catch(e) {}
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
  const { addRecent, addConnectedDApp } = useBrowserStore();
  const webViewRef = useRef<WebView>(null);
  const externalAuth = useExternalAuth();
  const { activeWallet } = useWallet();
  const { connect: wcConnect } = useWalletConnect();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isAuthInProgress, setIsAuthInProgress] = useState(false);
  const [isWcConnecting, setIsWcConnecting] = useState(false);
  const [debugHud, setDebugHud] = useState<{count:number; last:string}>({count:0, last:"(none)"});
  const wcPairingInProgress = useRef(false);
  const wcConnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleWalletConnectUri = useCallback(async (uri: string) => {
    try {
      if (!uri || !uri.startsWith("wc:")) return;
      if (wcPairingInProgress.current) {
        console.log("[BrowserWC] Pairing already in progress, ignoring");
        return;
      }
      wcPairingInProgress.current = true;
      setIsWcConnecting(true);
      console.log("[BrowserWC] Intercepted WC URI:", uri.substring(0, 50) + "...");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await wcConnect(uri);
    } catch (e) {
      console.log("[BrowserWC] Failed to pair:", e);
    } finally {
      wcPairingInProgress.current = false;
      setIsWcConnecting(false);
    }
  }, [wcConnect]);

  const handleWcButtonClicked = useCallback(() => {
    // Make idempotent - if already connecting, do nothing
    if (isWcConnecting) return;
    console.log("[BrowserWC] WalletConnect button clicked - showing loader");
    setIsWcConnecting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Auto-hide loading after 8 seconds if no URI captured
    if (wcConnectTimeout.current) clearTimeout(wcConnectTimeout.current);
    wcConnectTimeout.current = setTimeout(() => {
      setIsWcConnecting(false);
    }, 8000);
  }, [isWcConnecting]);

  const walletAddress = activeWallet?.addresses?.evm || activeWallet?.address || null;

  const [currentUrl, setCurrentUrl] = useState(route.params.url);
  const [pageTitle, setPageTitle] = useState(route.params.title || "");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [urlInput, setUrlInput] = useState(route.params.url);
  const [isEditing, setIsEditing] = useState(false);

  const [connectSheet, setConnectSheet] = useState<{
    visible: boolean;
    chain: "solana" | "evm";
    requestId: number;
    walletAddress: string;
    isGetWalletAddress?: boolean; // For cordon.getWalletAddress() calls
  } | null>(null);

  const [signSheet, setSignSheet] = useState<{
    visible: boolean;
    chain: "solana" | "evm";
    signType: "message" | "transaction";
    requestId: number;
    message?: string;
    transactionData?: string;
    isDrainerBlocked?: boolean;
    drainerType?: "SetAuthority" | "Assign";
    sendAfterSign?: boolean;
  } | null>(null);

  const [isSigning, setIsSigning] = useState(false);

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
    // Clear WC loader on navigation
    setIsWcConnecting(false);
    if (wcConnectTimeout.current) {
      clearTimeout(wcConnectTimeout.current);
      wcConnectTimeout.current = null;
    }
  }, []);

  const handleLoadStart = useCallback(() => {
    setIsLoading(true);
    loadingProgress.value = 0.1;
    // Clear WC loader on page load ONLY if not in active pairing
    if (!wcPairingInProgress.current) {
      setIsWcConnecting(false);
      if (wcConnectTimeout.current) {
        clearTimeout(wcConnectTimeout.current);
        wcConnectTimeout.current = null;
      }
    }
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
    try {
      webViewRef.current?.injectJavaScript(`
        (function(){
          try {
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
              window.ReactNativeWebView.postMessage("DEBUG_PING_onLoadEnd: " + location.href);
            }
          } catch(e) {}
        })();
        true;
      `);
    } catch (err) {
      console.log("[BrowserWebView] injectJavaScript failed:", err);
    }
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
    const raw = event?.nativeEvent?.data ?? "";
    setDebugHud(prev => ({ count: prev.count + 1, last: String(raw).slice(0, 160) }));
    console.log("[BrowserWebView] onMessage raw:", raw);
    
    // Handle debug/injection messages - ignore without touching loader
    if (typeof raw === "string" && (raw.startsWith("DEBUG_") || raw.startsWith("INJECT_") || raw.startsWith("PING_"))) {
      console.log("[BrowserWebView] Debug message:", raw);
      return;
    }
    
    // Handle self-test messages
    if (typeof raw === "string" && raw.startsWith("WC_SELFTEST_")) {
      console.log("[BrowserWebView] Self-test:", raw);
      return;
    }
    
    // Only attempt JSON parse if looks like JSON object with type
    const trimmed = (typeof raw === "string" ? raw.trim() : "");
    if (!trimmed.startsWith("{") || !trimmed.includes('"type"')) {
      console.log("[BrowserWebView] Ignoring non-JSON message");
      return;
    }
    
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch (parseError) {
      console.log("[BrowserWebView] JSON parse failed");
      return;
    }
    
    const msgType = data?.type;
    if (!msgType) return;
    console.log("[BrowserWebView] Message received:", msgType);

    // Handle known message types only
    if (msgType === "WC_CAPTURE_READY") {
      console.log("[BrowserWC] Capture script ready");
      return;
    }

    if (msgType === "WC_BUTTON_CLICKED") {
      // Noisy - just log, don't show loader
      console.log("[BrowserWC] WalletConnect button clicked (no loader)");
      return;
    }

    if (msgType === "WC_MODAL_OPENED") {
      console.log("[BrowserWC] Modal opened - scanning (no loader)");
      return;
    }

    if (msgType === "WC_CONNECTING") {
      console.log("[BrowserWC] WC_CONNECTING:", data.reason);
      handleWcButtonClicked();
      return;
    }

    if (msgType === "WC_MODAL_DETECTED") {
      console.log("[BrowserWC] Modal/QR detected - showing loader");
      handleWcButtonClicked();
      return;
    }

    if (msgType === "WALLETCONNECT_URI" || msgType === "WC_URI") {
      const wcUri = extractWalletConnectUri(data.uri);
      if (wcUri) {
        console.log("[BrowserWC] pairing", wcUri);
        handleWalletConnectUri(wcUri);
      }
      return;
    }

    if (msgType === "cordon_getWalletAddress") {
        // Show connect sheet for approval before sharing wallet address
        const solanaAddress = activeWallet?.addresses?.solana;
        
        if (!solanaAddress) {
          const response = { error: "No wallet available" };
          webViewRef.current?.injectJavaScript(`
            window.cordon._handleResponse(${data.requestId}, ${JSON.stringify(response)});
            true;
          `);
          return;
        }
        
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        
        // Use the connect sheet which will trigger addConnectedDApp on approval
        setConnectSheet({
          visible: true,
          chain: "solana",
          requestId: data.requestId,
          walletAddress: solanaAddress,
          isGetWalletAddress: true, // Flag to return address format
        });
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
        
        setConnectSheet({
          visible: true,
          chain: "solana",
          requestId: data.requestId,
          walletAddress: solanaAddress,
        });
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
        
        setSignSheet({
          visible: true,
          chain: "solana",
          signType: "message",
          requestId: data.requestId,
          message: messageText,
        });
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
        const userPubkey = activeWallet?.addresses?.solana || "";
        const decoded = decodeSolanaTransaction(txBase64, { userPubkey });
        
        const isBlocked = decoded.drainerDetection?.isBlocked === true;
        const drainerType = decoded.drainerDetection?.attackType as "SetAuthority" | "Assign" | undefined;
        
        if (isBlocked) {
          console.warn("[BrowserWebView] DRAINER BLOCKED:", drainerType);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
        
        setSignSheet({
          visible: true,
          chain: "solana",
          signType: "transaction",
          requestId: data.requestId,
          transactionData: txBase64,
          isDrainerBlocked: isBlocked,
          drainerType: drainerType,
          sendAfterSign: data.type === "cordon_solana_signAndSendTransaction",
        });
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
        
        setConnectSheet({
          visible: true,
          chain: "evm",
          requestId: data.requestId,
          walletAddress: evmAddress,
        });
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
        
        setSignSheet({
          visible: true,
          chain: "evm",
          signType: "message",
          requestId: data.requestId,
          message: messageText,
        });
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
        
        setSignSheet({
          visible: true,
          chain: "evm",
          signType: "transaction",
          requestId: data.requestId,
          message: `Transaction to ${data.transaction?.to?.slice(0, 10)}...`,
        });
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
  }, [walletAddress, isAuthInProgress, activeWallet, pageTitle, currentUrl, handleWalletConnectUri, handleWcButtonClicked, isWcConnecting]);

  const handleShouldStartLoad = useCallback(
    (request: { url: string }) => {
      const url = request.url;
      
      // Fast path: Check for WC deep links
      if (url.startsWith("wc:") || url.startsWith("walletconnect:") || url.startsWith("walletconnect://")) {
        console.log("[BrowserWC] Intercepted WC nav url");
        const wcUri = extractWalletConnectUri(url);
        if (wcUri) {
          handleWalletConnectUri(wcUri);
          return false;
        }
      }
      
      // Check for WalletConnect relay URLs with encoded URI
      if (url.includes("link.walletconnect.org/wc?uri=") || 
          url.includes("walletconnect.com/wc?uri=") ||
          (url.includes("wc?uri=") && url.includes("wc%3A"))) {
        console.log("[BrowserWC] Intercepted WC nav url");
        const wcUri = extractWalletConnectUri(url);
        if (wcUri) {
          handleWalletConnectUri(wcUri);
          return false;
        }
      }
      
      // Standard extraction as fallback
      const wcUri = extractWalletConnectUri(url);
      if (wcUri) {
        console.log("[BrowserWC] Intercepted WC nav url");
        handleWalletConnectUri(wcUri);
        return false;
      }

      if (externalAuth.isAuthTrigger(url)) {
        externalAuth.startAuth(url);
        return false;
      }

      return true;
    },
    [externalAuth, handleWalletConnectUri]
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

  const handleConnectApprove = useCallback(async () => {
    if (!connectSheet) return;
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    await addConnectedDApp({
      url: currentUrl,
      name: pageTitle || domain,
      favicon: getFaviconUrl(currentUrl),
      chain: connectSheet.chain,
      walletAddress: connectSheet.walletAddress,
    });
    
    // Handle different response formats based on the request type
    if (connectSheet.isGetWalletAddress) {
      // cordon.getWalletAddress() expects { address: string }
      const response = { address: connectSheet.walletAddress };
      webViewRef.current?.injectJavaScript(`
        window.cordon._handleResponse(${connectSheet.requestId}, ${JSON.stringify(response)});
        true;
      `);
    } else if (connectSheet.chain === "solana") {
      const response = { publicKey: connectSheet.walletAddress };
      webViewRef.current?.injectJavaScript(`
        window.cordon._handleResponse(${connectSheet.requestId}, ${JSON.stringify(response)});
        true;
      `);
    } else {
      const response = { accounts: [connectSheet.walletAddress], chainId: "0x89" };
      webViewRef.current?.injectJavaScript(`
        window.cordon._handleResponse(${connectSheet.requestId}, ${JSON.stringify(response)});
        true;
      `);
    }
    
    setConnectSheet(null);
  }, [connectSheet, currentUrl, pageTitle, domain, addConnectedDApp]);

  const handleConnectDeny = useCallback(() => {
    if (!connectSheet) return;
    
    const response = { error: "User rejected connection" };
    webViewRef.current?.injectJavaScript(`
      window.cordon._handleResponse(${connectSheet.requestId}, ${JSON.stringify(response)});
      true;
    `);
    
    setConnectSheet(null);
  }, [connectSheet]);

  const handleSignApprove = useCallback(async () => {
    if (!signSheet) return;
    
    const walletId = activeWallet?.id;
    if (!walletId) {
      setSignSheet(null);
      return;
    }
    
    setIsSigning(true);
    
    try {
      if (signSheet.chain === "solana") {
        if (signSheet.signType === "message") {
          const { signSolanaMessage } = await import("@/lib/blockchain/transactions");
          const bs58 = await import("bs58");
          const signatureBase58 = await signSolanaMessage({ walletId, message: signSheet.message! });
          const signatureBytes = bs58.default.decode(signatureBase58);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          const solanaAddress = activeWallet?.addresses?.solana;
          const response = { signature: Array.from(signatureBytes), publicKey: solanaAddress };
          webViewRef.current?.injectJavaScript(`
            window.cordon._handleResponse(${signSheet.requestId}, ${JSON.stringify(response)});
            true;
          `);
        } else if (signSheet.signType === "transaction") {
          const { signSolanaTransaction } = await import("@/lib/blockchain/transactions");
          const signedTxBase64 = await signSolanaTransaction({ walletId, transaction: signSheet.transactionData! });
          
          if (signSheet.sendAfterSign) {
            const apiUrl = getApiUrl();
            const sendUrl = new URL("/api/solana/send-signed-transaction", apiUrl);
            const sendResponse = await fetch(sendUrl.toString(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transactionBase64: signedTxBase64 }),
            });
            const sendResult = await sendResponse.json();
            if (sendResult.error) throw new Error(sendResult.error);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const response = { signature: sendResult.signature };
            webViewRef.current?.injectJavaScript(`
              window.cordon._handleResponse(${signSheet.requestId}, ${JSON.stringify(response)});
              true;
            `);
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const signedBytes = atob(signedTxBase64).split('').map(c => c.charCodeAt(0));
            const response = { signedTransaction: signedBytes };
            webViewRef.current?.injectJavaScript(`
              window.cordon._handleResponse(${signSheet.requestId}, ${JSON.stringify(response)});
              true;
            `);
          }
        }
      } else {
        if (signSheet.signType === "message") {
          const { signPersonalMessage } = await import("@/lib/blockchain/transactions");
          const signature = await signPersonalMessage({ walletId, message: signSheet.message! });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          webViewRef.current?.injectJavaScript(`
            window.cordon._handleResponse(${signSheet.requestId}, ${JSON.stringify(signature)});
            true;
          `);
        } else if (signSheet.signType === "transaction") {
          throw new Error("EVM transaction signing from browser not yet supported");
        }
      }
    } catch (error: any) {
      const response = { error: error.message || "Signing failed" };
      webViewRef.current?.injectJavaScript(`
        window.cordon._handleResponse(${signSheet.requestId}, ${JSON.stringify(response)});
        true;
      `);
    } finally {
      setIsSigning(false);
      setSignSheet(null);
    }
  }, [signSheet, activeWallet]);

  const handleSignReject = useCallback(() => {
    if (!signSheet) return;
    
    const response = signSheet.isDrainerBlocked
      ? { error: "Transaction blocked: Wallet drainer detected" }
      : { error: "User rejected signing" };
    
    webViewRef.current?.injectJavaScript(`
      window.cordon._handleResponse(${signSheet.requestId}, ${JSON.stringify(response)});
      true;
    `);
    
    setSignSheet(null);
  }, [signSheet]);

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
        injectedJavaScript={DEBUG_BOOT_SCRIPT}
        injectedJavaScriptBeforeContentLoaded={DEBUG_BOOT_SCRIPT}
        injectedJavaScriptForMainFrameOnly={false}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
        javaScriptEnabled={true}
        originWhitelist={["*"]}
        domStorageEnabled
        startInLoadingState
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        sharedCookiesEnabled
      />

      {__DEV__ ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: (insets?.top ?? 0) + 44,
            left: 12,
            right: 12,
            zIndex: 999999,
            elevation: 999999,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: "rgba(0,0,0,0.85)",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
            WV MSG #{debugHud.count}
          </Text>
          <Text style={{ color: "#fff", fontSize: 11 }} numberOfLines={3}>
            {debugHud.last}
          </Text>
        </View>
      ) : null}

      {isWcConnecting ? (
        <View style={wcOverlayStyles.overlay}>
          <View style={[wcOverlayStyles.card, { backgroundColor: theme.backgroundSecondary }]}>
            <ActivityIndicator size="large" color={theme.accent} />
            <ThemedText type="h4" style={{ marginTop: Spacing.md, textAlign: "center" }}>
              Connecting to dApp...
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: Spacing.xs, textAlign: "center" }}>
              Please wait
            </ThemedText>
          </View>
        </View>
      ) : null}

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

      <BrowserConnectSheet
        visible={connectSheet?.visible ?? false}
        siteName={pageTitle || "Unknown Site"}
        siteUrl={currentUrl}
        chain={connectSheet?.chain ?? "solana"}
        walletAddress={connectSheet?.walletAddress ?? ""}
        onConnect={handleConnectApprove}
        onDeny={handleConnectDeny}
      />

      <BrowserSignSheet
        visible={signSheet?.visible ?? false}
        siteName={pageTitle || "Unknown Site"}
        siteUrl={currentUrl}
        chain={signSheet?.chain ?? "solana"}
        signType={signSheet?.signType ?? "message"}
        message={signSheet?.message}
        transactionData={signSheet?.transactionData}
        isSigning={isSigning}
        isDrainerBlocked={signSheet?.isDrainerBlocked}
        drainerType={signSheet?.drainerType}
        onSign={handleSignApprove}
        onReject={handleSignReject}
      />
    </View>
  );
}

const wcOverlayStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  card: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.xl,
    alignItems: "center",
    minWidth: 200,
  },
});

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
