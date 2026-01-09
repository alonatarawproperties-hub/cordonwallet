# Cordon

## Overview

Cordon is a production-grade, non-custodial EVM wallet application built as a monorepo. The project consists of a React Native mobile app (via Expo) and a lightweight Express backend. The core differentiators are:

1. **Wallet Firewall** - Explain-before-sign functionality with enforceable transaction policies
2. **Bundles** - Multi-wallet management with batch operations
3. **AI Explainer** - Plain-English transaction explanations with risk assessment

The wallet supports Ethereum, Polygon, and BNB Chain networks, with architecture designed to add new EVM networks via configuration only.

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
- **@scure/bip32**: HD key derivation (BIP32/BIP44) using m/44'/60'/0'/0/0 path
- **@noble/hashes**: Cryptographic hashing (SHA-256, PBKDF2, keccak_256)
- **@noble/ciphers**: AES-256-GCM encryption for vault storage
- **viem**: EVM blockchain interactions (address utilities)
- **react-native-qrcode-svg**: QR code generation for receive addresses

### Wallet Security Model

- **Mnemonic Generation**: BIP39 12-word seed phrases using cryptographic entropy
- **Key Derivation**: Standard EVM HD path m/44'/60'/0'/0/0 for Ethereum-compatible addresses
- **Vault Encryption**: PBKDF2 (100,000 iterations) + AES-256-GCM with random salt/IV
- **PIN Storage**: SHA-256 hash stored separately from encrypted vault
- **Secure Storage**: Expo SecureStore (iOS Keychain / Android Keystore)

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
- **Transaction Module**: `client/lib/blockchain/transactions.ts` - sendNative/sendERC20 with gas estimation
  - EIP-1559 support with legacy chain fallback (BSC uses gasPrice)
  - Private keys derived on-demand from mnemonics for signing, never stored
- **Transaction History**: `client/lib/transaction-history.ts` - Local AsyncStorage for activity tracking

### Planned Integrations (Architecture Ready)

- **WalletConnect v2**: dApp connection protocol (not yet implemented)

### Database

- **PostgreSQL**: Via Drizzle ORM, configured in `drizzle.config.ts`
- **Connection**: Requires `DATABASE_URL` environment variable

### Development Tools

- **TypeScript**: Strict mode enabled
- **ESLint**: Expo config with Prettier integration
- **Babel**: Module resolver for path aliases, Reanimated plugin