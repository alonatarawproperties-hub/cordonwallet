# Cordon

## Overview

Cordon is a production-grade, non-custodial EVM and Solana wallet application delivered as a monorepo. It features a React Native mobile app and an Express backend. Its key differentiators include a Wallet Firewall for explain-before-sign functionality and enforceable transaction policies, Bundles for multi-wallet management with batch operations, and an AI Explainer for plain-English transaction explanations and risk assessment. The wallet supports major EVM networks (Ethereum, Polygon, BNB Chain) and Solana mainnet, deriving both EVM (0x...) and Solana (base58) addresses from a single mnemonic seed phrase. Key generation and storage are exclusively on-device using secure storage.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

- **Framework**: React Native with Expo SDK 54, leveraging the new architecture.
- **State Management**: React Context for wallet state and TanStack Query for server state.
- **Styling**: Custom theme system with light/dark mode support, adhering to a fintech-minimalist design.
- **Data Storage**: AsyncStorage for non-sensitive preferences and Expo SecureStore for sensitive, encrypted data.
- **Boot Sequence**: A robust splash screen preloads assets, initializes core services, prefetches cached portfolio data, and determines the initial app route, with built-in health checks and error recovery.
- **Portfolio Prefetching**: During app startup, the bootstrap process loads cached portfolio data (EVM and Solana assets) so the main screen displays instantly without loading delays. Fresh data is fetched in the background after the cached data is shown.

### Backend

- **Framework**: Express.js with TypeScript.
- **API**: RESTful routes, primarily serving non-sensitive metadata such as token lists and cached prices.
- **Storage**: In-memory storage, designed for future migration to persistent databases.

### Database

- **ORM**: Drizzle ORM with PostgreSQL dialect.
- **Schema**: Defined in `shared/schema.ts`, including a Users table.
- **Validation**: Zod schemas generated via drizzle-zod.

### Monorepo Structure

The project is organized into `/client` (frontend), `/server` (backend), and `/shared` (common types and schemas). It utilizes a reusable component library and screen-based navigation for modularity.

### Wallet Security Model

- **Mnemonic Generation**: BIP39 12-word seed phrases.
- **Multi-Chain Key Derivation**: Standard HD paths for EVM (BIP32/BIP44) and Solana (SLIP-0010 Ed25519).
- **Vault Encryption**: PBKDF2 + AES-256-GCM.
- **PIN Storage**: SHA-256 hash stored separately.
- **Secure Storage**: Expo SecureStore.
- **Session Management**: Vaults are decrypted on-demand for signing and cached in memory, with clear lock/unlock flows and error handling for locked or corrupted states.

### Blockchain Interaction

- **Chain Registry**: Configuration for supported EVM chains (Ethereum, Polygon, BSC) and Solana.
- **RPC Client**: `viem` for EVM and `@solana/web3.js` for Solana, with caching and error handling.
- **Balance & Portfolio**: Unified portfolio view combining EVM and Solana assets with real-time balance fetching and price enrichment.
- **Transaction Module**: Handles native, ERC-20, and SPL token transfers, approvals, and signing, with gas estimation and EIP-1559 support. Private keys are derived on-demand.
- **Transaction History**: Local storage for activity tracking and Etherscan V2 API for fetching detailed history.

### Security Hub & Wallet Firewall

- **EVM Approvals**: Tracks ERC-20 token approvals with risk assessment (unlimited, high-value, stale permissions) and provides revoke/cap allowance functionalities.
- **Solana Permissions**: Manages WalletConnect sessions and SPL token delegates.
- **Approval Policies**: Enforces denylist/allowlist and blocks unlimited approvals, with a UI for capping allowances when blocked.
- **Wallet Drainer Protection**: Automatic detection and hard-blocking of Solana SetAuthority and Assign instruction attacks. These attacks attempt to change wallet/token account ownership to steal funds permanently. The decoder (`client/lib/solana/decoder.ts`) scans all Solana transactions before signing and blocks them if drainer instructions are detected. Protection is enforced in both WalletConnect handler and in-app browser dApp connections.

### WalletConnect v2 Integration

- **SDKs**: `@walletconnect/web3wallet`, `@walletconnect/core`.
- **Functionality**: Manages session establishment, approval, and signing requests for both EVM (eth_sendTransaction, personal_sign) and Solana (solana_signMessage, solana_signTransaction) methods.
- **Security**: Integrates with the Wallet Firewall for transaction approval intents and policy enforcement.
- **Multi-Chain Support**: Automatically handles namespace building for EVM and Solana, ensuring correct address provisioning.

### Solana Swap (Jupiter Integration)

- **SwapScreen**: Native Solana token swap interface with token selectors, live quotes (auto-refresh every 1.5s), slippage controls, and speed modes (standard/fast/turbo).
- **Jupiter API**: Integration for quote fetching and swap transaction building via `client/services/jupiter.ts`.
- **Token List Service**: Cached token list with 24h TTL, searchable by symbol/name/mint address (`client/services/solanaTokenList.ts`).
- **Fee Controller**: Compute budget instructions for priority fees with configurable caps per speed mode (`client/lib/solana/feeController.ts`).
- **Swap Security Gate**: Allowlist validation for Jupiter programs, drainer detection, and fee payer verification (`client/lib/solana/swapSecurity.ts`).
- **Transaction Broadcaster**: Dual RPC support (primary Helius + fallback) with automatic rebroadcast and confirmation polling (`client/services/txBroadcaster.ts`).
- **Swap Store**: AsyncStorage-backed history and metrics tracking (`client/services/swapStore.ts`).
- **Speed Modes**: Standard (0.0008 SOL cap), Fast (0.002 SOL), Turbo (0.005 SOL, max 0.02 SOL for advanced).
- **SwapHistoryScreen**: View past swaps with status indicators and explorer links.
- **SwapDebugScreen**: Configuration viewer and session metrics.

### Browser/dApps Interface

- **BrowserScreen**: Main discovery tab with search bar, active WalletConnect sessions, browsing recents, and curated popular dApps grid with security banner.
- **BrowserWebViewScreen**: In-app WebView browser with full navigation controls (back/forward/refresh/share), URL bar, security status, and history tracking with smart filtering to exclude favicons and assets.
- **BrowserStore**: AsyncStorage-backed persistence for browsing history with 50-item limit and favicon caching.
- **dApps Catalog**: Curated list of popular dApps organized by category (DeFi, DEX, NFT, Bridge, Lending) at `client/data/dapps.ts`.
- **Session Management**: Connected dApps display in both Browser tab and Security/Approvals screen with Solana-specific enrichment (verification badges, chain indicators).

## External Dependencies

### Mobile/Expo

- `expo-secure-store`: Secure key storage.
- `expo-local-authentication`: Biometric authentication.
- `expo-clipboard`, `expo-haptics`, `expo-web-browser`.

### Cryptography

- `@scure/bip39`, `@scure/bip32`: Mnemonic and HD key derivation.
- `@noble/hashes`, `@noble/ciphers`: Cryptographic hashing and AES-256-GCM encryption.
- `viem`: EVM utilities.
- `@solana/web3.js`, `@solana/spl-token`, `tweetnacl`, `bs58`: Solana interactions.
- `react-native-qrcode-svg`: QR code generation.

### Blockchain Infrastructure

- **Solana RPC**: Paid Helius RPC (configured via `SOLANA_RPC_URL` secret) with automatic fallback to public Solana RPC on rate limit/access errors.
- **CoinGecko API**: Primary source for major token prices.
- **DexScreener API**: Fallback for long-tail token prices via DEX liquidity pools.

### Database

- **PostgreSQL**: Used with Drizzle ORM.