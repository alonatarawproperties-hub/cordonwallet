# Cordon

## Overview

Cordon is a production-grade, non-custodial EVM wallet application built as a monorepo. The project consists of a React Native mobile app (via Expo) and a lightweight Express backend. The core differentiators are:

1. **Wallet Firewall** - Explain-before-sign functionality with enforceable transaction policies
2. **Bundles** - Multi-wallet management with batch operations
3. **AI Explainer** - Plain-English transaction explanations with risk assessment

The wallet supports Ethereum, Polygon, BNB Chain, and **Solana mainnet** networks. The multi-protocol architecture derives both EVM (0x...) and Solana (base58) addresses from a single mnemonic seed phrase.

**Security Model**: Keys are generated and stored exclusively on-device using secure storage (iOS Keychain / Android Keystore via Expo SecureStore). The backend handles only non-sensitive metadata like token lists and price caching.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

- **Framework**: React Native with Expo SDK 54 (new architecture enabled)
- **Navigation**: React Navigation v7 with native stack and bottom tabs
- **State Management**: React Context (`WalletProvider`) for wallet state, TanStack Query for server state
- **Styling**: Custom theme system with light/dark mode support, following fintech-minimalist design guidelines
- **Storage**: 
  - AsyncStorage for non-sensitive preferences
  - Expo SecureStore for sensitive data (PIN-derived encryption keys)
- **Animations**: React Native Reanimated for micro-interactions

### Backend Architecture

- **Framework**: Express.js with TypeScript
- **Server**: Standard HTTP server with CORS configured for Replit domains
- **API Pattern**: RESTful routes prefixed with `/api`
- **Storage**: In-memory storage implementation with interface ready for database migration

### Database Schema

- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts`
- **Current Tables**: Users table with UUID primary keys
- **Validation**: Zod schemas generated via drizzle-zod

### Path Aliases

- `@/*` → `./client/*` (frontend code)
- `@shared/*` → `./shared/*` (shared types and schemas)

### Key Design Patterns

1. **Monorepo Structure**: Client code in `/client`, server in `/server`, shared code in `/shared`
2. **Component Library**: Reusable themed components (Button, Card, Input, Badge, etc.) in `/client/components`
3. **Screen-based Navigation**: Each feature has dedicated screen components in `/client/screens`
4. **Hook Abstraction**: Custom hooks for theme, screen options, and color scheme

## External Dependencies

### Mobile/Expo Plugins

- **expo-secure-store**: Secure key storage (Keychain/Keystore)
- **expo-local-authentication**: Biometric authentication (Face ID, fingerprint)
- **expo-clipboard**: Address copying functionality
- **expo-haptics**: Tactile feedback for user actions
- **expo-web-browser**: dApp browser integration

### Cryptography Libraries (Implemented)

- **@scure/bip39**: BIP39-compliant mnemonic generation and validation (wordlist: english)
- **@scure/bip32**: HD key derivation (BIP32/BIP44) using m/44'/60'/0'/0/0 path for EVM
- **@noble/hashes**: Cryptographic hashing (SHA-256, SHA-512, HMAC, PBKDF2, keccak_256)
- **Custom Ed25519 HD key derivation**: Solana key derivation using m/44'/501'/0'/0' path (SLIP-0010 spec) - implemented in `client/lib/solana/keys.ts` using `@noble/hashes/sha2` and `@noble/hashes/hmac` to avoid Node.js dependencies
- **@noble/ciphers**: AES-256-GCM encryption for vault storage
- **viem**: EVM blockchain interactions (address utilities)
- **@solana/web3.js**: Solana RPC client and transaction handling
- **@solana/spl-token**: SPL token interactions (transfers, account management)
- **tweetnacl**: Ed25519 signature verification for Solana
- **bs58**: Base58 encoding for Solana addresses
- **react-native-qrcode-svg**: QR code generation for receive addresses

### Wallet Security Model

- **Mnemonic Generation**: BIP39 12-word seed phrases using cryptographic entropy
- **Multi-Chain Key Derivation**:
  - EVM: Standard HD path m/44'/60'/0'/0/0 for Ethereum-compatible addresses
  - Solana: HD path m/44'/501'/0'/0' for Ed25519 keypairs (SLIP-0010)
- **Vault Encryption**: PBKDF2 (100,000 iterations) + AES-256-GCM with random salt/IV
- **PIN Storage**: SHA-256 hash stored separately from encrypted vault
- **Secure Storage**: Expo SecureStore (iOS Keychain / Android Keystore)
- **Address Model**: `MultiChainAddresses` interface stores both `evm` and `solana` addresses per wallet

### Session Model

- **Unlock Flow**: `unlockWithPin()` decrypts vault and caches secrets in memory (`cachedSecrets`)
- **Session State**: `isVaultUnlocked` boolean tracks whether wallet is unlocked
- **Lock Flow**: `lock()` clears `cachedSecrets` and sets `isVaultUnlocked = false`
- **Guard Function**: `requireUnlocked()` throws `WalletLockedError` if session is invalid
- **Error Types**:
  - `WalletLockedError` (code: `WALLET_LOCKED`) - thrown when signing attempted while locked
  - `VaultCorruptedError` (code: `VAULT_CORRUPTED`) - thrown when vault decryption yields malformed data
  - `TransactionFailedError` - wraps blockchain errors, preserves original error code
- **Recovery Flow**: `repairCorruptedVault()` + `resetWalletState()` clears all storage and context

### Blockchain Infrastructure

- **Chain Registry**: `client/lib/blockchain/chains.ts` - Ethereum, Polygon, BSC configs with RPC URLs
- **RPC Client**: `client/lib/blockchain/client.ts` - viem public client with caching and error handling
- **Balance Fetchers**: `client/lib/blockchain/balances.ts` - Native and ERC-20 balance reads
- **Token List**: `client/lib/blockchain/tokens.ts` - Default tokens per chain (USDC, USDT, DAI, WBTC, etc.)
- **Portfolio Hook**: `client/hooks/usePortfolio.ts` - React hook for fetching real balances with caching
- **All-Chains Portfolio Hook**: `client/hooks/useAllChainsPortfolio.ts` - EVM portfolio fetching with price enrichment
- **Solana Portfolio Hook**: `client/hooks/useSolanaPortfolio.ts` - Solana balance fetching via backend API
- **Unified Portfolio UI**: TrustWallet-style unified view combining EVM and Solana assets in a single sorted list by value
- **Transaction Module**: `client/lib/blockchain/transactions.ts` - sendNative/sendERC20/sendApproval with gas estimation
  - EIP-1559 support with legacy chain fallback (BSC uses gasPrice)
  - Private keys derived on-demand from mnemonics for signing, never stored
  - Approval policy enforcement before broadcasting approval transactions
- **Transaction History**: `client/lib/transaction-history.ts` - Local AsyncStorage for activity tracking
- **Explorer API**: `client/lib/blockchain/explorer-api.ts` - Etherscan V2 API for fetching transaction history

### EVM Approvals & Wallet Firewall

- **Approvals Module**: `client/lib/approvals/` - Complete ERC20 approval tracking and management
  - `types.ts`: ApprovalRecord, DetectedApproval, ApprovalPolicyResult interfaces
  - `store.ts`: AsyncStorage persistence per wallet/chain at `@cordon/approvals/<address>/<chainId>`
  - `detect.ts`: detectApproveIntent() for parsing ERC20 approve(spender, amount) calldata
  - `firewall.ts`: checkApprovalPolicy() enforces denylist/allowlist and unlimited approval blocking
  - `revoke.ts`: revokeApproval() sends approve(spender, 0) transaction to revoke access
  - `spenders.ts`: Known spender labels (Uniswap, 1inch, PancakeSwap, Aave, etc.)
- **Unlimited Detection**: Flags approvals >= MAX_UINT256 / 2 as unlimited
- **Policy Settings**: blockUnlimitedApprovals, allowlistedAddresses, denylistedAddresses
- **Revoke Flow**: Optimistic UI update, then on-chain approve(spender, 0) with status tracking
- **ApprovalsScreen**: Real-time approval list with revoke buttons and firewall status indicators
- **Cap Allowance UI**: When unlimited approvals are blocked, users can set capped limits:
  - `CapAllowanceSheet`: Modal with token/spender info, balance-based presets (25%, 50%, 100%), and custom input
  - `CapAllowanceProvider`: Context wrapping the app to show cap sheet when approvals are blocked
  - Safety guardrails: Over-cap warning when amount exceeds balance by >5%, requires explicit confirmation
  - Zero/unknown balance handling: Automatically switches to custom mode with helpful message
  - WalletConnect support: `checkWalletConnectApprove()` and `modifyApproveCalldata()` helpers for dApp requests

### Price Data Services

- **CoinGecko API**: Primary source for major token prices (ETH, MATIC, BNB, BTC, stablecoins)
  - Backend endpoint: `/api/prices` with 60-second caching
  - Supports native tokens and common ERC-20s by symbol
- **DexScreener API**: Fallback for tokens not on CoinGecko (e.g., pump.fun tokens, new launches)
  - Backend endpoints: `/api/dexscreener/token/:chainId/:address` (single) and `/api/dexscreener/tokens` (batch)
  - No API key required, 300 requests/minute rate limit
  - Fetches prices from on-chain DEX liquidity pools
  - Auto-selects pair with highest liquidity for price accuracy

### WalletConnect v2 Integration

- **SDK**: @walletconnect/web3wallet, @walletconnect/core
- **Location**: `client/lib/walletconnect/` module
  - `client.ts`: Web3Wallet client initialization, session management, AsyncStorage persistence
  - `context.tsx`: WalletConnectProvider with pending proposal/request state management
  - `handlers.ts`: Request parsing for personal_sign, eth_sendTransaction, approval detection
- **UI Components**:
  - `WalletConnectScreen`: Main connection hub with QR scanner, paste URI, active sessions list
  - `WCScannerScreen`: Camera-based QR code scanning for WC URIs
  - `SessionApprovalSheet`: Modal for approving/rejecting dApp connection requests
  - `SignRequestSheet`: Modal for signing messages and transactions with firewall integration
- **Supported Methods**: eth_sendTransaction, personal_sign, eth_sign, eth_signTypedData, eth_signTypedData_v4
- **Supported Chains**: eip155:1 (Ethereum), eip155:137 (Polygon), eip155:56 (BNB Chain)
- **Firewall Integration**: Approval intents detected via `checkWalletConnectApprove()`, unlimited approvals can trigger Cap Allowance flow
- **Environment Variable**: Requires `WC_PROJECT_ID` secret from WalletConnect Cloud

### Database

- **PostgreSQL**: Via Drizzle ORM, configured in `drizzle.config.ts`
- **Connection**: Requires `DATABASE_URL` environment variable

### Development Tools

- **TypeScript**: Strict mode enabled
- **ESLint**: Expo config with Prettier integration
- **Babel**: Module resolver for path aliases, Reanimated plugin