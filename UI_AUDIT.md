# Cordon Wallet - UI/UX Audit Report

**Date:** 2026-02-01
**Scope:** Core wallet flows (portfolio, send/receive, key/seed reveal/export)

---

## Executive Summary

The UI is visually consistent with the theme system and uses shared components (ThemedText/ThemedView), but several UX and accessibility gaps remain. The most impactful issues are: lack of error states in key screens, remote token imagery without fallbacks, and theme-unsafe QR rendering. Accessibility labeling is also missing on sensitive actions (seed phrase reveal/copy and private key copy). These gaps reduce resilience under poor network conditions and make core flows harder to use with assistive technology.

---

## Findings

### 1. Token/Chain Logos Have No Network Failure Fallbacks
**Severity:** MEDIUM

Token rows and chain filters render remote images, but do not provide `onError` fallbacks or placeholders. If a URL fails to load (spotty connectivity, CDN outage), the UI shows empty slots instead of a fallback icon/initials.

**Evidence:**
- Send token list uses remote `logoUrl` with no error handling or fallback once the URL is set.【F:client/screens/SendScreen.tsx†L250-L307】
- Portfolio token row renders `Image` with remote logo and chain overlay without `onError` fallback.【F:client/screens/PortfolioScreen.tsx†L170-L193】

**Recommendation:**
- Provide an `onError` handler to toggle a local icon/initials fallback.
- Cache failed URLs to avoid repeated broken renders.

---

### 2. Send Screen Lacks Error States for Asset Fetch Failures
**Severity:** MEDIUM

The Send screen only surfaces a loading indicator and empty-state message. It does not display errors from the portfolio hooks, which can leave users in a silent failure state if RPC or API calls fail.

**Evidence:**
- `useAllChainsPortfolio` and `useSolanaPortfolio` are used without surfacing errors.【F:client/screens/SendScreen.tsx†L137-L196】
- Render logic only branches on `isLoading` or empty list; no error UI is rendered.【F:client/screens/SendScreen.tsx†L360-L395】

**Recommendation:**
- Bubble up `error` from the hooks and show a retry banner or inline error state.

---

### 3. QR Codes Ignore Theme Colors (Dark Mode Contrast Risk)
**Severity:** LOW

Receive QR rendering hardcodes white background and black foreground, which can clash with dark themes and produce abrupt visual contrast in dark mode.

**Evidence:**
- QRCode is rendered with fixed `backgroundColor="white"` and `color="black"`.【F:client/screens/ReceiveScreen.tsx†L384-L390】

**Recommendation:**
- Use theme-aware colors for QR background/foreground or place the QR on a themed container with consistent contrast.

---

### 4. Missing Accessibility Labels on Sensitive Pressables
**Severity:** MEDIUM

Several core actions use `Pressable` without accessibility props. This makes it harder for screen readers to describe security-sensitive actions such as revealing or copying seed phrases and private keys.

**Evidence:**
- Seed phrase reveal/copy actions use `Pressable` without `accessibilityLabel` or `accessibilityRole`.【F:client/screens/SeedPhraseScreen.tsx†L62-L95】
- Private key copy actions use `Pressable` without accessibility metadata.【F:client/screens/PrivateKeyExportScreen.tsx†L147-L191】

**Recommendation:**
- Add `accessibilityRole="button"` and descriptive `accessibilityLabel` for each action.
- Include `accessibilityHint` for sensitive operations (e.g., "Copies seed phrase to clipboard").

---

## Suggested Next Steps

1. Add error handling UI on Send/Receive/Portfolio flows to avoid silent failures.
2. Introduce a shared `TokenLogo` component with fallback logic and caching.
3. Make QR rendering theme-aware.
4. Apply accessibility metadata to all Pressables across the wallet setup and export flows.

---

*This audit is based on the current code in the repository and should be re-run after UI changes are applied.*
