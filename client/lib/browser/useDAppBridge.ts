/**
 * React hook that bridges the injected provider ↔ wallet engine.
 *
 * Handles incoming postMessage requests from the WebView's injected JS,
 * performs wallet operations (connect, sign, send), and returns responses
 * back into the WebView.
 */

import { useCallback, useRef, useState } from "react";
import type { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import { useWallet } from "@/lib/wallet-context";
import {
  getMnemonic,
  getWalletPrivateKey,
  ensureUnlocked,
} from "@/lib/wallet-engine";
import { deriveSolanaKeypair } from "@/lib/solana/keys";
import * as nacl from "tweetnacl";
import bs58 from "bs58";

// ---- Types ----------------------------------------------------------------

interface IncomingMessage {
  type: string;
  id: string;
  payload: Record<string, unknown>;
}

export interface PendingApproval {
  id: string;
  type: "connect" | "signMessage" | "signTransaction" | "signAndSendTransaction" | "signAllTransactions";
  origin: string;
  /** Human-readable description shown in the approval sheet */
  detail: string;
  /** Raw payload from the dApp */
  payload: Record<string, unknown>;
}

// ---- Hook ------------------------------------------------------------------

export function useDAppBridge(webViewRef: React.RefObject<WebView | null>, pageOrigin: string) {
  const { activeWallet } = useWallet();
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  // Keep a ref to the resolve/reject of the currently pending approval so the
  // approve/reject callbacks can settle it.
  const pendingPromiseRef = useRef<{
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  } | null>(null);

  // ---- Send a response back to the WebView ---------------------------------

  const respond = useCallback(
    (id: string, error: string | null, result: unknown) => {
      const js = `window.__cordonResponse(${JSON.stringify(id)}, ${JSON.stringify(error)}, ${JSON.stringify(result)}); true;`;
      webViewRef.current?.injectJavaScript(js);
    },
    [webViewRef],
  );

  // ---- Helpers: get signing keypair ----------------------------------------

  const getSolanaKeypair = useCallback(async () => {
    if (!activeWallet) throw new Error("No active wallet");

    const unlocked = await ensureUnlocked({ skipBiometric: true });
    if (!unlocked) throw new Error("Wallet is locked");

    const mnemonic = await getMnemonic(activeWallet.id);
    if (mnemonic) {
      return deriveSolanaKeypair(mnemonic);
    }

    // Wallet may have been imported via private key (no mnemonic).
    // Try private key fallback before erroring out.
    const pk = await getWalletPrivateKey(activeWallet.id);
    if (pk && pk.type === "solana") {
      const secretKey = bs58.decode(pk.key);
      const kp = nacl.sign.keyPair.fromSecretKey(secretKey);
      return { publicKey: bs58.encode(kp.publicKey), secretKey: kp.secretKey };
    }

    throw new Error("Wallet is locked — please unlock and try again");
  }, [activeWallet]);

  // ---- Request handler (called from onMessage) -----------------------------

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: IncomingMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data) as IncomingMessage;
      } catch {
        return; // Not a cordon message — ignore
      }

      // Only handle messages from our injected provider
      if (!msg.type || !msg.id) return;

      const { type, id, payload } = msg;

      switch (type) {
        // -- Connect: always requires user approval --------------------------
        case "connect": {
          if (!activeWallet?.addresses?.solana) {
            respond(id, "No Solana wallet available", null);
            return;
          }

          const approval: PendingApproval = {
            id,
            type: "connect",
            origin: pageOrigin,
            detail: "wants to connect to your wallet",
            payload,
          };
          setPendingApproval(approval);
          pendingPromiseRef.current = {
            resolve: () => {
              const pubKey = activeWallet.addresses!.solana;
              respond(id, null, { publicKey: pubKey });
              // Emit connect event
              const js = `window.__cordonEvent('connect', { publicKey: ${JSON.stringify(pubKey)} }); true;`;
              webViewRef.current?.injectJavaScript(js);
            },
            reject: (err) => respond(id, err.message, null),
          };
          break;
        }

        // -- Disconnect ------------------------------------------------------
        case "disconnect": {
          const js = `window.__cordonEvent('disconnect'); true;`;
          webViewRef.current?.injectJavaScript(js);
          respond(id, null, {});
          break;
        }

        // -- Sign message ----------------------------------------------------
        case "signMessage": {
          const approval: PendingApproval = {
            id,
            type: "signMessage",
            origin: pageOrigin,
            detail: "requests you to sign a message",
            payload,
          };
          setPendingApproval(approval);
          pendingPromiseRef.current = {
            resolve: async () => {
              try {
                const kp = await getSolanaKeypair();
                // payload.message is base64-encoded
                const msgBytes = Uint8Array.from(
                  atob(payload.message as string)
                    .split("")
                    .map((c) => c.charCodeAt(0)),
                );
                const sig = nacl.sign.detached(msgBytes, kp.secretKey);
                respond(id, null, { signature: bs58.encode(sig) });
              } catch (e: any) {
                respond(id, e.message || "Signing failed", null);
              }
            },
            reject: (err) => respond(id, err.message, null),
          };
          break;
        }

        // -- Sign transaction ------------------------------------------------
        case "signTransaction": {
          const approval: PendingApproval = {
            id,
            type: "signTransaction",
            origin: pageOrigin,
            detail: "requests you to sign a transaction",
            payload,
          };
          setPendingApproval(approval);
          pendingPromiseRef.current = {
            resolve: async () => {
              try {
                const kp = await getSolanaKeypair();
                const txBytes = Uint8Array.from(
                  atob(payload.transaction as string)
                    .split("")
                    .map((c) => c.charCodeAt(0)),
                );
                const sig = nacl.sign.detached(txBytes, kp.secretKey);
                respond(id, null, {
                  signature: bs58.encode(sig),
                  signedTransaction: payload.transaction, // dApp reconstructs
                });
              } catch (e: any) {
                respond(id, e.message || "Signing failed", null);
              }
            },
            reject: (err) => respond(id, err.message, null),
          };
          break;
        }

        // -- Sign and send transaction ---------------------------------------
        case "signAndSendTransaction": {
          const approval: PendingApproval = {
            id,
            type: "signAndSendTransaction",
            origin: pageOrigin,
            detail: "requests you to sign and send a transaction",
            payload,
          };
          setPendingApproval(approval);
          pendingPromiseRef.current = {
            resolve: async () => {
              try {
                const kp = await getSolanaKeypair();
                const txBytes = Uint8Array.from(
                  atob(payload.transaction as string)
                    .split("")
                    .map((c) => c.charCodeAt(0)),
                );
                const sig = nacl.sign.detached(txBytes, kp.secretKey);
                // The dApp sent us the serialized transaction; we sign it and
                // return the signature. Broadcast is the dApp's responsibility
                // for now (matching the standard adapter pattern).
                respond(id, null, { signature: bs58.encode(sig) });
              } catch (e: any) {
                respond(id, e.message || "Signing failed", null);
              }
            },
            reject: (err) => respond(id, err.message, null),
          };
          break;
        }

        // -- Sign all transactions -------------------------------------------
        case "signAllTransactions": {
          const approval: PendingApproval = {
            id,
            type: "signAllTransactions",
            origin: pageOrigin,
            detail: `requests you to sign ${(payload.transactions as string[])?.length ?? 0} transactions`,
            payload,
          };
          setPendingApproval(approval);
          pendingPromiseRef.current = {
            resolve: async () => {
              try {
                const kp = await getSolanaKeypair();
                const txs = payload.transactions as string[];
                const signatures = txs.map((tx) => {
                  const txBytes = Uint8Array.from(
                    atob(tx)
                      .split("")
                      .map((c) => c.charCodeAt(0)),
                  );
                  return bs58.encode(nacl.sign.detached(txBytes, kp.secretKey));
                });
                respond(id, null, { signatures });
              } catch (e: any) {
                respond(id, e.message || "Signing failed", null);
              }
            },
            reject: (err) => respond(id, err.message, null),
          };
          break;
        }

        default:
          respond(id, `Unknown request type: ${type}`, null);
      }
    },
    [activeWallet, pageOrigin, respond, getSolanaKeypair, webViewRef],
  );

  // ---- Approval callbacks (called from the UI) -----------------------------

  const approveRequest = useCallback(async () => {
    const p = pendingPromiseRef.current;
    setPendingApproval(null);
    pendingPromiseRef.current = null;
    if (p) {
      try {
        await p.resolve(undefined);
      } catch (e: any) {
        console.error("[DAppBridge] approve handler error:", e);
      }
    }
  }, []);

  const rejectRequest = useCallback(() => {
    const p = pendingPromiseRef.current;
    setPendingApproval(null);
    pendingPromiseRef.current = null;
    if (p) p.reject(new Error("User rejected the request"));
  }, []);

  return {
    handleMessage,
    pendingApproval,
    approveRequest,
    rejectRequest,
  };
}
