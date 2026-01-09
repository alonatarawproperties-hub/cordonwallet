# Placeholder/Mock Data Audit

This document maps all placeholder, mock, demo, stub, and hardcoded data in the Cordon codebase.

---

## Summary

| Feature Area | Files with Placeholders | Impact |
|-------------|------------------------|--------|
| Wallet Creation | CreateWalletScreen.tsx, ImportWalletScreen.tsx | Fake seed phrases and addresses |
| Balances/Tokens | PortfolioScreen.tsx, SendScreen.tsx, AssetDetailScreen.tsx | Hardcoded token balances and prices |
| Transactions | ActivityScreen.tsx, TransactionDetailScreen.tsx | Mock transaction history |
| Token Approvals | ApprovalsScreen.tsx | Mock approval data |
| Wallet Manager | WalletManagerScreen.tsx, CreateBundleScreen.tsx | Fallback mock wallets |
| Send Flow | SendScreen.tsx | Fake transaction submission, hardcoded gas |
| QR/Receive | ReceiveScreen.tsx | QR placeholder (no real generation) |

---

## Detailed Breakdown

### 1. Wallet Creation (Critical - Security)

**File: `client/screens/CreateWalletScreen.tsx`**
- **Lines 21-38**: `generateSeedPhrase()` - Creates fake seed phrase from limited 64-word list (not BIP39 compliant)
- **Lines 40-47**: `generateAddress()` - Generates random hex string (not derived from seed)
- **Affects**: Wallet creation flow, backup flow
- **Called by**: CreateWalletScreen on "Create Wallet" button press

**File: `client/screens/ImportWalletScreen.tsx`**
- **Lines 20-27**: `generateAddress()` - Same fake address generation
- **Affects**: Wallet import flow (seed validation is bypassed, address is random)
- **Called by**: ImportWalletScreen on "Import" button press

---

### 2. Portfolio/Balances (Critical - Data)

**File: `client/screens/PortfolioScreen.tsx`**
- **Lines 23-27**: `MOCK_TOKENS` array with hardcoded balances:
  ```
  ETH: 2.5421 ($4,523.12)
  USDC: 1,250.00 ($1,250.00)
  MATIC: 5,421.32 ($3,252.79)
  ```
- **Affects**: Main portfolio display, total balance calculation
- **Called by**: PortfolioScreen (main tab)

**File: `client/screens/SendScreen.tsx`**
- **Lines 40-44**: Hardcoded `tokens` array with fixed balances and prices:
  ```
  ETH: 2.5421 @ $1780
  USDC: 1,250.00 @ $1
  MATIC: 5,421.32 @ $0.85
  ```
- **Affects**: Token selection in send flow, balance validation
- **Called by**: SendScreen

**File: `client/screens/AssetDetailScreen.tsx`**
- **Lines 33-40**: `mockAsset` object with hardcoded asset details
- **Lines 19-30**: `MOCK_TXS` array with transaction history for asset
- **Affects**: Individual token detail view
- **Called by**: AssetDetailScreen (from portfolio tap)

---

### 3. Transaction History (Medium - Data)

**File: `client/screens/ActivityScreen.tsx`**
- **Lines 20-29**: `MockTransaction` interface
- **Lines 31-51**: `MOCK_TRANSACTIONS` array with 4 fake transactions (send, receive, approve, swap)
- **Line 50**: `setTimeout` for fake refresh animation (1s delay)
- **Affects**: Activity tab, transaction list
- **Called by**: ActivityScreen (activity tab)

**File: `client/screens/TransactionDetailScreen.tsx`**
- **Lines 27-41**: `mockTx` object with hardcoded transaction details
- **Line 47**: `setTimeout` for copy feedback
- **Affects**: Transaction detail modal
- **Called by**: TransactionDetailScreen (from activity tap or send completion)

---

### 4. Token Approvals (Medium - Data)

**File: `client/screens/ApprovalsScreen.tsx`**
- **Lines 14-23**: `MockApproval` interface
- **Lines 24-28**: `MOCK_APPROVALS` array with 3 fake approvals (Uniswap, Aave, 1inch)
- **Affects**: Approvals list, revoke functionality (shows alert but doesn't execute)
- **Called by**: ApprovalsScreen (from settings)

---

### 5. Send Transaction Flow (Critical - Functionality)

**File: `client/screens/SendScreen.tsx`**
- **Lines 161-165**: Fake transaction submission with `setTimeout`:
  ```javascript
  setTimeout(() => {
    setIsSending(false);
    navigation.goBack();
    Alert.alert("Success", "Transaction submitted successfully!");
  }, 1500);
  ```
- **Lines 284-296**: Hardcoded gas fee display (~0.002 ETH / ~$3.50)
- **Affects**: Send flow - appears to work but no actual blockchain interaction
- **Called by**: SendScreen "Confirm" button

---

### 6. Wallet Manager / Bundles (Low - UX Fallback)

**File: `client/screens/WalletManagerScreen.tsx`**
- **Lines 57-59**: Fallback `mockWallets` when no wallets exist:
  ```javascript
  const mockWallets = wallets.length > 0 ? wallets : [
    { id: "1", name: "Main Wallet", address: "0x1234567890abcdef1234567890abcdef12345678", createdAt: Date.now() },
  ];
  ```
- **Affects**: Wallet manager when wallet array is empty
- **Called by**: WalletManagerScreen

**File: `client/screens/CreateBundleScreen.tsx`**
- **Lines 63-66**: Same fallback pattern for bundle creation
- **Affects**: Bundle wallet selection when no wallets exist
- **Called by**: CreateBundleScreen

---

### 7. Receive/QR Code (Medium - Functionality)

**File: `client/screens/ReceiveScreen.tsx`**
- **Line 46**: `qrPlaceholder` View instead of actual QR code generation
- **Line 33**: `setTimeout` for copy feedback
- **Affects**: Receive screen - shows placeholder instead of scannable QR
- **Called by**: ReceiveScreen

---

### 8. Other setTimeout Usages (UX Polish)

| File | Line | Purpose |
|------|------|---------|
| TransactionDetailScreen.tsx | 47 | Copy feedback reset (2s) |
| PortfolioScreen.tsx | 43, 51 | Refresh animation (1s), copy feedback (2s) |
| ReceiveScreen.tsx | 33 | Copy feedback (2s) |
| SeedPhraseScreen.tsx | 31 | Copy feedback (2s) |

These are acceptable UX patterns, not blocking placeholders.

---

## Call Graph Summary

```
Welcome Screen
  └── Create Wallet → CreateWalletScreen
        ├── generateSeedPhrase() [MOCK]
        ├── generateAddress() [MOCK]
        └── BackupWarningScreen → SeedPhraseScreen → MainTabs

  └── Import Wallet → ImportWalletScreen
        ├── generateAddress() [MOCK]
        └── MainTabs

MainTabs
  ├── Portfolio Tab → PortfolioScreen
  │     ├── MOCK_TOKENS [MOCK]
  │     └── Tap Token → AssetDetailScreen
  │           ├── mockAsset [MOCK]
  │           └── MOCK_TXS [MOCK]
  │
  ├── Activity Tab → ActivityScreen
  │     ├── MOCK_TRANSACTIONS [MOCK]
  │     └── Tap Tx → TransactionDetailScreen
  │           └── mockTx [MOCK]
  │
  └── Settings Tab → SettingsScreen
        ├── Wallet Manager → WalletManagerScreen
        │     └── mockWallets fallback [MOCK]
        ├── Token Approvals → ApprovalsScreen
        │     └── MOCK_APPROVALS [MOCK]
        └── Create Bundle → CreateBundleScreen
              └── mockWallets fallback [MOCK]

Send Flow (from any screen)
  └── SendScreen
        ├── tokens array [MOCK]
        ├── hardcoded gas [MOCK]
        └── setTimeout submission [MOCK]

Receive Flow
  └── ReceiveScreen
        └── qrPlaceholder [MOCK]
```

---

## Priority for Real Implementation

### P0 - Critical (Blocks real usage)
1. **Wallet Creation**: generateSeedPhrase, generateAddress (need viem/ethers)
2. **Send Transaction**: Actual blockchain submission (need viem + provider)
3. **Token Balances**: Real RPC calls for balance fetching

### P1 - High (Core functionality)
4. **Transaction History**: Index past transactions from blockchain
5. **Token Approvals**: Fetch real approval data from chain
6. **QR Code**: Generate actual QR from address

### P2 - Medium (Data enrichment)
7. **Price Feeds**: Real price data API integration
8. **Gas Estimation**: Dynamic gas from network

### P3 - Low (Can remain as fallbacks)
9. **Wallet Manager fallback**: OK as empty state fallback
10. **Copy feedback timeouts**: Acceptable UX pattern
