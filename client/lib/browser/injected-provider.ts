/**
 * Injected JavaScript provider for Cordon's in-app dApp browser.
 *
 * This script is injected into every WebView page via
 * `injectedJavaScriptBeforeContentLoaded`. It exposes `window.cordon`
 * (and `window.solana` for standard adapter compatibility) so dApps can
 * detect the wallet and request connect / sign / disconnect operations.
 *
 * Communication with the native side uses `window.ReactNativeWebView.postMessage`
 * (outgoing) and `document.addEventListener("cordon:response", ...)` (incoming).
 */

export function buildInjectedJS(opts: {
  publicKey: string | null;
  isConnected: boolean;
}): string {
  // The script is a self-contained IIFE that runs in the WebView context.
  // We JSON-encode the initial state so it's safely embedded.
  const initialState = JSON.stringify({
    publicKey: opts.publicKey,
    isConnected: opts.isConnected,
  });

  return `(function() {
  'use strict';

  // Prevent double-injection
  if (window.__cordonInjected) return;
  window.__cordonInjected = true;

  var _state = ${initialState};
  var _requestId = 0;
  var _pending = {};
  var _listeners = {};

  // Base58 alphabet for encoding/decoding (matches Solana PublicKey)
  var BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function base58ToBytes(str) {
    var alphabet = BASE58_ALPHABET;
    var bytes = [0];
    for (var i = 0; i < str.length; i++) {
      var value = alphabet.indexOf(str[i]);
      if (value < 0) throw new Error('Invalid base58 character');
      for (var j = 0; j < bytes.length; j++) {
        bytes[j] = bytes[j] * 58 + value;
        value = bytes[j] >> 8;
        bytes[j] &= 0xff;
      }
      while (value > 0) {
        bytes.push(value & 0xff);
        value >>= 8;
      }
    }
    // Leading zeros
    for (var k = 0; k < str.length && str[k] === '1'; k++) {
      bytes.push(0);
    }
    return new Uint8Array(bytes.reverse());
  }

  // Create a Solana PublicKey-compatible object from a base58 string
  function makePublicKey(base58Str) {
    if (!base58Str) return null;
    return {
      _base58: base58Str,
      toBase58: function() { return base58Str; },
      toString: function() { return base58Str; },
      toJSON: function() { return base58Str; },
      toBytes: function() { return base58ToBytes(base58Str); },
      equals: function(other) {
        if (!other) return false;
        var otherStr = typeof other === 'string' ? other : (other.toBase58 ? other.toBase58() : String(other));
        return base58Str === otherStr;
      }
    };
  }

  // ---- Internal helpers ----

  function nextId() {
    return 'crd_' + (++_requestId) + '_' + Date.now();
  }

  function sendToNative(type, payload) {
    var id = nextId();
    return new Promise(function(resolve, reject) {
      _pending[id] = { resolve: resolve, reject: reject };

      // Guard: ReactNativeWebView may not be available immediately on all
      // platforms (Android injects it slightly after document-start).
      // Poll briefly then give up with a clear error.
      function trySend(attempts) {
        if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: type,
              id: id,
              payload: payload || {}
            }));
          } catch(e) {
            delete _pending[id];
            reject(new Error('Cordon bridge error: ' + e.message));
          }
          return;
        }
        if (attempts > 0) {
          setTimeout(function() { trySend(attempts - 1); }, 50);
        } else {
          delete _pending[id];
          reject(new Error('Cordon bridge not available'));
        }
      }
      trySend(20); // Try for up to 1 second (20 * 50ms)
    });
  }

  function emit(event, data) {
    var cbs = _listeners[event];
    if (cbs) {
      cbs.forEach(function(cb) {
        try { cb(data); } catch(e) { console.error('[Cordon] listener error', e); }
      });
    }
  }

  // Native side sends responses via this global handler
  window.__cordonResponse = function(id, error, result) {
    var p = _pending[id];
    if (!p) return;
    delete _pending[id];
    if (error) {
      p.reject(new Error(error));
    } else {
      p.resolve(result);
    }
  };

  // Native side can push state changes (connect, disconnect, accountChanged)
  window.__cordonEvent = function(event, data) {
    if (event === 'connect') {
      _state.isConnected = true;
      _state.publicKey = typeof data.publicKey === 'string' ? data.publicKey : (data.publicKey && data.publicKey._base58 ? data.publicKey._base58 : data.publicKey);
      emit(event, { publicKey: makePublicKey(_state.publicKey) });
      return;
    } else if (event === 'disconnect') {
      _state.isConnected = false;
      _state.publicKey = null;
    } else if (event === 'accountChanged') {
      var rawKey = typeof data.publicKey === 'string' ? data.publicKey : (data.publicKey && data.publicKey._base58 ? data.publicKey._base58 : data.publicKey);
      _state.publicKey = rawKey || null;
      _state.isConnected = !!rawKey;
      emit(event, { publicKey: makePublicKey(_state.publicKey) });
      return;
    }
    emit(event, data);
  };

  // ---- Provider object ----

  var provider = {
    isCordon: true,

    get isConnected() { return _state.isConnected; },
    get publicKey() { return makePublicKey(_state.publicKey); },

    connect: function() {
      return sendToNative('connect').then(function(result) {
        _state.isConnected = true;
        _state.publicKey = result.publicKey;
        var pk = makePublicKey(result.publicKey);
        emit('connect', { publicKey: pk });
        return { publicKey: pk };
      });
    },

    disconnect: function() {
      return sendToNative('disconnect').then(function() {
        _state.isConnected = false;
        _state.publicKey = null;
        emit('disconnect');
      });
    },

    signMessage: function(message) {
      if (!_state.isConnected) return Promise.reject(new Error('Wallet not connected'));
      // message should be Uint8Array — convert to base64 for transport
      var base64;
      if (message instanceof Uint8Array) {
        var binary = '';
        for (var i = 0; i < message.length; i++) {
          binary += String.fromCharCode(message[i]);
        }
        base64 = btoa(binary);
      } else if (typeof message === 'string') {
        base64 = btoa(message);
      } else {
        return Promise.reject(new Error('message must be Uint8Array or string'));
      }
      return sendToNative('signMessage', { message: base64 }).then(function(result) {
        // Standard Solana adapter expects signature as Uint8Array, not base58 string
        return { signature: base58ToBytes(result.signature) };
      });
    },

    signTransaction: function(transaction) {
      if (!_state.isConnected) return Promise.reject(new Error('Wallet not connected'));
      return sendToNative('signTransaction', { transaction: transaction });
    },

    signAndSendTransaction: function(transaction, options) {
      if (!_state.isConnected) return Promise.reject(new Error('Wallet not connected'));
      return sendToNative('signAndSendTransaction', {
        transaction: transaction,
        options: options || {}
      });
    },

    signAllTransactions: function(transactions) {
      if (!_state.isConnected) return Promise.reject(new Error('Wallet not connected'));
      return sendToNative('signAllTransactions', { transactions: transactions });
    },

    on: function(event, callback) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(callback);
    },

    off: function(event, callback) {
      var cbs = _listeners[event];
      if (!cbs) return;
      _listeners[event] = cbs.filter(function(cb) { return cb !== callback; });
    }
  };

  // Expose as window.cordon (primary) and window.solana (standard adapter compat)
  window.cordon = provider;

  // Only set window.solana if no other wallet already claimed it.
  // This avoids clobbering Phantom or Backpack if they somehow also inject.
  if (!window.solana) {
    window.solana = provider;
  }

  // Dispatch a custom event so dApps doing lazy detection can pick it up
  try {
    window.dispatchEvent(new Event('cordon:ready'));
  } catch(e) {}

  // ---- Wallet Standard registration ----
  // Deferred to run AFTER the page's own JS initializes, preventing
  // interference with page rendering in the WebView.
  setTimeout(function() { try {
    var SOLANA_MAINNET = 'solana:mainnet';

    function makeAccount() {
      if (!_state.publicKey) return null;
      return Object.freeze({
        address: _state.publicKey,
        publicKey: base58ToBytes(_state.publicKey),
        chains: [SOLANA_MAINNET],
        features: ['solana:signMessage', 'solana:signTransaction', 'solana:signAndSendTransaction']
      });
    }

    var cordonStandard = {
      version: '1.0.0',
      name: 'Cordon',
      icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjI0IiBmaWxsPSIjMzg4QkZEIi8+PHRleHQgeD0iNjQiIHk9Ijg4IiBmb250LXNpemU9IjcyIiBmb250LWZhbWlseT0ic3lzdGVtLXVpLHNhbnMtc2VyaWYiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXdlaWdodD0iYm9sZCI+QzwvdGV4dD48L3N2Zz4=',
      chains: [SOLANA_MAINNET],
      accounts: [],
      features: {}
    };

    cordonStandard.features['standard:connect'] = {
      version: '1.0.0',
      connect: function() {
        return provider.connect().then(function() {
          var acct = makeAccount();
          cordonStandard.accounts = acct ? [acct] : [];
          return { accounts: cordonStandard.accounts };
        });
      }
    };

    cordonStandard.features['standard:disconnect'] = {
      version: '1.0.0',
      disconnect: function() {
        return provider.disconnect().then(function() {
          cordonStandard.accounts = [];
        });
      }
    };

    cordonStandard.features['standard:events'] = {
      version: '1.0.0',
      on: function(event, listener) {
        if (event === 'change') {
          var handler = function() {
            var acct = makeAccount();
            cordonStandard.accounts = acct ? [acct] : [];
            listener({ accounts: cordonStandard.accounts });
          };
          provider.on('connect', handler);
          provider.on('disconnect', handler);
          provider.on('accountChanged', handler);
          return function() {
            provider.off('connect', handler);
            provider.off('disconnect', handler);
            provider.off('accountChanged', handler);
          };
        }
        return function() {};
      }
    };

    cordonStandard.features['solana:signMessage'] = {
      version: '1.0.0',
      signMessage: function(inputs) {
        if (!Array.isArray(inputs)) inputs = [inputs];
        return Promise.all(inputs.map(function(input) {
          return provider.signMessage(input.message).then(function(result) {
            return { signedMessage: input.message, signature: result.signature };
          });
        }));
      }
    };

    cordonStandard.features['solana:signTransaction'] = {
      version: '1.0.0',
      signTransaction: function(inputs) {
        if (!Array.isArray(inputs)) inputs = [inputs];
        return Promise.all(inputs.map(function(input) {
          return provider.signTransaction(input.transaction);
        }));
      }
    };

    cordonStandard.features['solana:signAndSendTransaction'] = {
      version: '1.0.0',
      signAndSendTransaction: function(inputs) {
        if (!Array.isArray(inputs)) inputs = [inputs];
        return Promise.all(inputs.map(function(input) {
          return provider.signAndSendTransaction(input.transaction, input.options || {});
        }));
      }
    };

    var register = function(api) { api.register(cordonStandard); };

    if (!window.navigator.wallets) window.navigator.wallets = [];
    window.navigator.wallets.push(register);

    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', {
      detail: register
    }));
  } catch(e) {} }, 0);

  true; // Required: injectedJavaScript must end with a truthy expression
})();`;
}
