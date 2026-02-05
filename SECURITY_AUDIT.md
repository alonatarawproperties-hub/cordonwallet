# Cordon Wallet - Security Audit Report

**Date:** 2026-02-01
**Scope:** Full codebase review - client, server, cryptography, key management, API security
**Severity Levels:** CRITICAL / HIGH / MEDIUM / LOW / INFO

---

## Executive Summary

Cordon is a well-structured non-custodial wallet with good cryptographic library choices (`@scure/bip39`, `@noble/hashes`, `tweetnacl`, AES-GCM). However, the audit identified **several critical and high-severity issues** that should be addressed before production deployment, primarily around PIN verification bypass, web platform secrets exposure, server API authentication, and memory handling of sensitive data.

---

## CRITICAL Issues

### 1. PIN Verification is Decoupled from Vault Decryption - Bypass Risk
**File:** `client/lib/wallet-engine.ts:534-612`
**Severity:** CRITICAL

The `unlockWithPin()` function first verifies the PIN via a stored SHA-256 hash (`verifyPin()`), then tries a **cached vault key** that bypasses PBKDF2 entirely. The problem:

- The PIN hash (`cordon_pin_hash`) is a simple `SHA-256(pin)` with **no salt** (line 502).
- The cached vault key in SecureStore allows unlock **without ever re-deriving from the PIN**.
- If an attacker can overwrite `cordon_pin_hash` in SecureStore with `SHA-256(their_pin)`, the cached vault key still works, giving them access.

**The PIN hash check and the actual vault decryption are independent paths.** The cached key path at line 570-584 succeeds regardless of what PIN was entered, as long as `verifyPin()` passes first.

**Recommendation:**
- Remove the separate PIN hash storage entirely. The vault decryption itself (PBKDF2 + AES-GCM) **is** the PIN verification - if decryption fails, the PIN is wrong.
- If you need fast unlock, derive a secondary verification tag from the PBKDF2 key and store that, so the cached key and PIN verification are cryptographically linked.

### 2. Web Platform Stores Secrets in localStorage (Plaintext)
**File:** `client/lib/wallet-engine.ts:258-263`, `client/lib/secure-storage.ts:10-16`
**Severity:** CRITICAL

On `Platform.OS === "web"`, all "secure" storage falls back to `localStorage`:
- Encrypted vault → `localStorage`
- Cached vault key (raw AES key in hex) → `localStorage`
- PIN hash → `localStorage`
- Seed phrases → `localStorage` (via `secure-storage.ts`)

`localStorage` is accessible to **any JavaScript running on the same origin**, including XSS attacks, browser extensions, and dev tools. The cached vault key stored in plaintext hex at `CACHED_VAULT_KEY` means an attacker doesn't even need to crack the PIN.

**Recommendation:**
- If web is a supported platform, use the Web Crypto API's `CryptoKey` with `extractable: false` for the vault key, stored in IndexedDB.
- At minimum, **never store the raw vault key** in localStorage. Remove the cached vault key feature on web entirely.
- Consider whether web should be a supported platform at all for a non-custodial wallet.

### 3. Duplicate Seed Storage System - Orphaned Secrets
**File:** `client/lib/secure-storage.ts` (entire file)
**Severity:** CRITICAL

There are **two independent systems** storing seed phrases:
1. **wallet-engine.ts**: Stores mnemonics inside the encrypted vault (`cordon_vault`)
2. **secure-storage.ts**: Stores seed phrases separately under `cordon_seed_{walletId}` keys

The `secure-storage.ts` file stores seed phrases as **plaintext JSON arrays** in SecureStore/localStorage, completely bypassing the vault encryption system. This file appears to be a legacy/unused module, but if it's called anywhere, it's a direct secret leak.

**Recommendation:**
- Verify `secure-storage.ts` is unused. If unused, **delete it entirely**.
- If used, migrate all storage through the encrypted vault system.
- Audit all callers of `saveSeedPhrase()` / `getSeedPhrase()`.

### 4. Server API Endpoints Have Zero Authentication
**File:** `server/routes.ts` (entire file)
**Severity:** CRITICAL

All server endpoints are completely unauthenticated:
- `/api/solana/prepare-sol-transfer` - Anyone can prepare transactions
- `/api/solana/send-signed-transaction` - Anyone can submit transactions
- `/api/solana/send-raw-transaction` - Anyone can broadcast raw transactions
- `/api/solana/portfolio/:address` - Anyone can query any wallet
- `/api/jupiter/swap` - Anyone can build swap transactions

While the wallet signing happens client-side (good), the server is an open proxy to Solana RPC, Jupiter, Etherscan, and CoinGecko APIs. This means:
- API keys (Etherscan, Helius RPC) are consumed by anyone
- Rate limits are per-IP, easily bypassed
- The server can be used as a free API proxy by third parties

**Recommendation:**
- Add API key authentication for the mobile app (e.g., a shared secret or signed request headers).
- At minimum, add origin checking / CORS restrictions for all API routes.
- Consider moving transaction preparation to the client side entirely.

---

## HIGH Issues

### 5. Unsalted PIN Hash Enables Rainbow Table Attacks
**File:** `client/lib/wallet-engine.ts:502`
**Severity:** HIGH

```typescript
const pinHash = bytesToHex(sha256(new TextEncoder().encode(pin)));
```

The PIN is 6 digits (1,000,000 possibilities). A single SHA-256 with no salt means:
- Entire keyspace can be precomputed in milliseconds
- If the PIN hash leaks (web localStorage, device backup), the PIN is instantly recovered

**Recommendation:**
- As noted in Critical #1, remove the separate PIN hash. Use vault decryption as the sole verification.

### 6. `addWalletToExistingVault` Stores Random Salt but Uses Cached Key
**File:** `client/lib/wallet-engine.ts:840-851`
**Severity:** HIGH

When adding a wallet to an existing vault, a new random salt is generated (line 840) but the encryption uses the **cached vault key** (line 843), not a key derived from the salt. The salt stored in the vault is therefore **meaningless** - it doesn't correspond to the key used.

This means if the user changes their PIN, the vault is re-encrypted with a new PBKDF2-derived key, but the salt in the vault header won't match what's needed to re-derive that key. This could cause **permanent vault lockout** in edge cases.

**Recommendation:**
- When re-encrypting with the cached key, preserve the original salt, OR
- Re-derive the key from the PIN + new salt every time, OR
- Store the relationship between salt and key explicitly.

### 7. Secrets Remain in JavaScript Heap - No Memory Wiping
**File:** `client/lib/wallet-engine.ts:59, 505-506`
**Severity:** HIGH

```typescript
let cachedSecrets: DecryptedSecrets | null = null;
```

Decrypted mnemonics and private keys live in a module-level JavaScript variable indefinitely while unlocked. JavaScript has no reliable way to wipe memory, but the current code doesn't even attempt to:
- Zero out `Uint8Array` buffers after use (key derivation outputs, signing keys)
- Minimize the window where secrets are in memory
- Clear derived keypairs after signing

In `client/lib/solana/transactions.ts:42`:
```typescript
const { publicKey, secretKey } = deriveSolanaKeypair(mnemonic);
```
The `secretKey` (64 bytes) persists in the closure until garbage collected.

In `client/screens/SwapScreen.tsx:715-716`:
```typescript
const { secretKey } = deriveSolanaKeypair(mnemonic);
const keypair = Keypair.fromSecretKey(secretKey);
```
The secret key is promoted into a `Keypair` without any wipe, extending the lifetime of key material beyond the signing step.

In `client/lib/blockchain/keys.ts:13-17`:
```typescript
const { secretKey } = deriveSolanaKeypair(mnemonic);
return bs58.encode(secretKey);
```
The secret key is converted into an encoded string for export without any attempt to zero memory afterward.

**Recommendation:**
- Zero out `Uint8Array` key material after use: `secretKey.fill(0)`
- Implement an auto-lock timer that calls `lock()` after inactivity
- Minimize the scope of key material - derive, sign, wipe in a tight block

### 8. Transaction Message Substitution Attack (Server-Side Preparation)
**File:** `client/lib/solana/transactions.ts:37-91`, `server/solana-api.ts:487-514`
**Severity:** HIGH

The transaction flow is:
1. Client sends parameters to server (`prepare-sol-transfer`)
2. Server builds transaction, returns `transactionBase64` + `message` (base64)
3. Client signs the `message` bytes with the private key
4. Client sends `transactionBase64` + `signature` + `publicKey` back to server
5. Server attaches signature to original transaction and submits

The client trusts the server-provided `message` bytes blindly. A compromised or MITM'd server could return a different transaction message (e.g., sending funds to an attacker address) and the client would sign it without verification.

**Recommendation:**
- **Client should deserialize and validate the transaction** before signing: verify the `to` address, amount, and program IDs match what was requested.
- Alternatively, build transactions entirely on the client side and only use the server to submit signed transactions.

### 9. Debug Endpoint Leaks Active Auth Codes and Sessions
**File:** `server/cordon-auth.ts:937-977`
**Severity:** HIGH

The `/api/auth/cordon/debug` endpoint is **unauthenticated** and exposes:
- All active auth codes (full codes, not truncated)
- All active sessions (partial IDs + emails)
- All active mobile sessions

This allows an attacker to intercept auth codes and hijack authentication flows.

**Recommendation:**
- Remove entirely in production, or
- Gate behind admin authentication
- At minimum, redact the auth codes

---

## MEDIUM Issues

### 10. JWT Signature Comparison is Not Timing-Safe
**File:** `server/cordon-auth.ts:110`
**Severity:** MEDIUM

```typescript
if (signature !== expectedSig) {
```

String comparison is not constant-time. This enables timing attacks to forge JWT signatures byte-by-byte.

**Recommendation:**
Use `crypto.timingSafeEqual()`:
```typescript
const sigBuffer = Buffer.from(signature, 'base64url');
const expectedBuffer = Buffer.from(expectedSig, 'base64url');
if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
  return { valid: false };
}
```

### 11. SESSION_SECRET Fallback Generates Random Value Per Call
**File:** `server/cordon-auth.ts:81-88`
**Severity:** MEDIUM

When `SESSION_SECRET` is not set, `getSessionSecret()` generates a new random secret **every time it's called**. This means:
- JWTs are signed with different keys on every request
- No JWT can ever be verified after signing
- Server restart invalidates all sessions

**Recommendation:**
- Generate the fallback once at startup and cache it
- Log a FATAL error and refuse to start without `SESSION_SECRET` in production

### 12. Auth Code Brute Force - Only 6 Hex Characters
**File:** `server/cordon-auth.ts:77-78`
**Severity:** MEDIUM

```typescript
function generateCode(): string {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
```

3 bytes = 16,777,216 possibilities. Combined with rate limiting of 10/minute, this is ~1.6M minutes to brute force. However, the rate limit is per-IP and trivially bypassed with rotating IPs.

**Recommendation:**
- Increase to at least 6 bytes (12 hex chars)
- Add account lockout after N failed attempts
- Bind codes to specific session IDs

### 13. XSS in Auth Callback HTML Response
**File:** `server/cordon-auth.ts:219, 408, 487`
**Severity:** MEDIUM

User-controlled values are interpolated directly into HTML responses without escaping:
```typescript
<p>${error}</p>          // line 219 - error query param
<p class="email">${userEmail}</p>  // line 408
<p>${err.message}</p>    // line 487
```

If `error` or `userEmail` contains HTML/JS, it executes in the user's browser.

**Recommendation:**
- HTML-escape all interpolated values
- Use a templating engine with auto-escaping

### 14. No PIN Attempt Limiting / Lockout
**File:** `client/lib/wallet-engine.ts:534`
**Severity:** MEDIUM

There's no limit on PIN unlock attempts. A 6-digit PIN has only 1,000,000 combinations. On a modern device, PBKDF2 with 100K iterations of SHA-256 takes ~100ms per attempt, meaning the entire keyspace can be brute-forced in ~28 hours.

**Recommendation:**
- Implement exponential backoff on failed attempts
- After N failures (e.g., 10), require a longer cooldown or wipe the vault
- Store the attempt counter in SecureStore (not AsyncStorage)

### 15. CORS is Only Applied to Auth Routes
**File:** `server/cordon-auth.ts:168-170`
**Severity:** MEDIUM

CORS middleware is only applied to `/auth/cordon` and `/api/auth/cordon` routes. All other API routes (`/api/solana/*`, `/api/jupiter/*`, `/api/prices`, etc.) have no CORS restrictions, meaning any website can call them.

**Recommendation:**
- Apply CORS middleware globally or to all API routes

### 16. Sensitive Data Copied to Clipboard Without Auto-Clear
**File:** `client/screens/SeedPhraseScreen.tsx:20-41`, `client/screens/SeedPhraseExportScreen.tsx:56-79`, `client/screens/PrivateKeyExportScreen.tsx:95-122`
**Severity:** MEDIUM

Seed phrases and private keys are copied into the system clipboard, but the app never clears the clipboard afterward. This allows other apps, keyboards, or system services to read long-lived clipboard contents.

**Recommendation:**
- Auto-clear the clipboard after a short timeout (e.g., 30-60 seconds)
- Warn users and provide a "clear clipboard" action after copy
- Avoid clipboard copy for private keys entirely when possible

---

## LOW Issues

### 17. Wallet ID Uses `Date.now()` - Collisions Possible
**File:** `client/lib/wallet-engine.ts:463`
**Severity:** LOW

```typescript
const walletId = `wallet_${Date.now()}`;
```

If two wallets are created within the same millisecond (e.g., during import flow), they'll have the same ID, causing data corruption.

**Recommendation:**
Use `crypto.randomUUID()` or append random bytes.

### 18. `getRecentBlockhash` is Deprecated
**File:** `server/solana-api.ts:1113`
**Severity:** LOW

```typescript
const { feeCalculator } = await connection.getRecentBlockhash();
```

`getRecentBlockhash` is deprecated in favor of `getLatestBlockhash` + `getFeeForMessage`.

### 19. Error Messages Leak Internal State
**File:** Various server files
**Severity:** LOW

Error responses include raw error messages like `error.message` which may expose internal paths, stack traces, or configuration details to clients.

### 20. No HTTPS Enforcement on Server
**File:** `server/routes.ts:1638`
**Severity:** LOW

The server creates a plain HTTP server. In production, HTTPS should be enforced either at the server level or via a reverse proxy.

---

## INFO / Positive Observations

### Things Done Well:
1. **Good crypto library choices** - `@scure/bip39`, `@noble/hashes`, `@noble/ciphers` are audited, modern libraries. No use of deprecated `crypto-js`.
2. **AES-GCM for vault encryption** - Authenticated encryption prevents tampering.
3. **PBKDF2 with 100K iterations** - Reasonable for mobile devices.
4. **Client-side signing** - Private keys never leave the device. Server only sees signed transactions.
5. **Swap transaction security validation** - Server-side validation of Jupiter swap transactions against an allowlist of known programs is good defense.
6. **BIP44 standard derivation paths** - Standard paths for both EVM (`m/44'/60'/0'/0/0`) and Solana (`m/44'/501'/0'/0'`).
7. **Rate limiting on swap/quote endpoints** - Prevents abuse of Jupiter proxy.
8. **Biometric PIN protected with `requireAuthentication`** - Uses platform secure enclave correctly.
9. **Token approval detection and revocation** - Good security feature for users.
10. **RPC failover logic** - Graceful degradation when primary RPC is rate-limited.

---

## Priority Action Items

| Priority | Issue | Effort |
|----------|-------|--------|
| P0 | #1 Fix PIN verification / cached key bypass | Medium |
| P0 | #2 Fix web platform secret storage | Medium |
| P0 | #3 Remove or secure duplicate seed storage | Low |
| P0 | #4 Add API authentication to server | Medium |
| P1 | #5 Remove unsalted PIN hash | Low |
| P1 | #8 Client-side transaction validation | Medium |
| P1 | #9 Remove/secure debug endpoint | Low |
| P1 | #7 Memory wiping for key material | Low |
| P1 | #6 Fix salt/key mismatch in addWallet | Low |
| P2 | #10 Timing-safe JWT comparison | Low |
| P2 | #11 Fix SESSION_SECRET fallback | Low |
| P2 | #13 Fix XSS in auth callbacks | Low |
| P2 | #14 Add PIN attempt limiting | Medium |
| P2 | #15 Global CORS policy | Low |
| P2 | #16 Clipboard auto-clear for secrets | Medium |
| P3 | #12 Increase auth code entropy | Low |
| P3 | #17-20 Low severity fixes | Low |

---

*This audit covers the codebase as of commit 8d4a424. A follow-up audit should be performed after fixes are applied.*
