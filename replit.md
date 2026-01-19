# Cordon

## Overview
Cordon is a production-grade, non-custodial EVM and Solana wallet application distributed as a monorepo, featuring a React Native mobile app and an Express backend. Its core purpose is to provide secure, user-friendly cryptocurrency management with advanced features. Key functionalities include a Wallet Firewall for pre-transaction analysis and policy enforcement, Bundles for multi-wallet batch operations, and an AI Explainer for simplifying transaction details and assessing risks. It supports major EVM networks (Ethereum, Polygon, BNB Chain) and Solana, deriving both EVM and Solana addresses from a single mnemonic. All key generation and storage are securely handled on-device.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The project is organized into `/client` (React Native frontend), `/server` (Express.js backend), and `/shared` (common types and schemas), promoting modularity and code reuse.

### Frontend
- **Framework**: React Native with Expo SDK 54, utilizing the new architecture.
- **State Management**: React Context for local state, TanStack Query for server-side state.
- **Styling**: Custom theme system supporting light/dark modes, adhering to a fintech-minimalist design.
- **Data Storage**: AsyncStorage for non-sensitive data, Expo SecureStore for encrypted sensitive data.
- **Boot Sequence**: Robust startup process with asset preloading, service initialization, and cached portfolio data prefetching for a fast user experience.

### Backend
- **Framework**: Express.js with TypeScript.
- **API**: RESTful, primarily serving non-sensitive metadata like token lists and cached prices, designed for scalability and future database integration.

### Database
- **ORM**: Drizzle ORM with PostgreSQL dialect.
- **Schema**: Defined in `shared/schema.ts`, including a Users table.
- **Validation**: Zod schemas generated via drizzle-zod.

### Wallet Security Model
- **Key Derivation**: BIP39 12-word seed phrases with standard HD paths for EVM (BIP32/BIP44) and Solana (SLIP-0010 Ed25519).
- **Encryption**: PBKDF2 + AES-256-GCM for vault encryption; SHA-256 for PIN storage.
- **Secure Storage**: Leverages Expo SecureStore for on-device protection.
- **Session Management**: On-demand decryption of vaults for signing, with clear lock/unlock mechanisms.

### Blockchain Interaction
- **Multi-Chain Support**: Configuration for supported EVM chains (Ethereum, Polygon, BSC) and Solana.
- **RPC Clients**: `viem` for EVM and `@solana/web3.js` for Solana, including caching and error handling.
- **Portfolio Management**: Unified view of EVM and Solana assets with real-time balance fetching and price enrichment.
- **Transaction Handling**: Supports native, ERC-20, and SPL token transfers, approvals, and signing with gas estimation and EIP-1559.
- **Transaction History**: Local storage complemented by Etherscan V2 API for detailed history.

### Security Hub & Wallet Firewall
- **Approval Management**: Tracks and assesses risks for ERC-20 token approvals (unlimited, high-value, stale) and Solana SPL token delegates, offering revoke/cap functionalities.
- **Policy Enforcement**: Configurable denylist/allowlist, blocking unlimited approvals, with UI for capping allowances.
- **Drainer Protection**: Automatic detection and hard-blocking of Solana SetAuthority and Assign instruction attacks to prevent asset theft.

### WalletConnect v2 Integration
- **SDKs**: `@walletconnect/web3wallet`, `@walletConnect/core`.
- **Functionality**: Manages session establishment, approval, and signing requests for both EVM (eth_sendTransaction, personal_sign) and Solana (solana_signMessage, solana_signTransaction).
- **Security**: Integrates with the Wallet Firewall for transaction approval and policy enforcement.
- **Multi-Chain Support**: Handles namespace building for EVM and Solana for correct address provisioning.

### Solana Swap (Intelligent Routing)
- **Swap Interface**: Native Solana token swap with token selectors, live quotes, slippage controls, and speed modes.
- **Intelligent Routing Engine**: Server-side route decision-making (`server/swap/route.ts`) prioritizing Pump.fun bonding curves for new tokens and Jupiter DEX for established assets, with fallbacks and Token-2022 awareness.
- **Unified Quote Engine**: Handles quotes from different routes, managing polling intervals, deduplication, and stale responses.
- **Security Gate**: Allowlist validation for swap programs, drainer detection, and fee payer verification.

### Browser/dApps Interface
- **BrowserScreen**: Discovery tab with search, active WalletConnect sessions, browsing history, and a curated list of popular dApps.
- **BrowserWebViewScreen**: In-app WebView with full navigation controls, URL bar, security status, and history tracking.
- **dApps Catalog**: Curated list of dApps categorized by function.
- **Session Management**: Displays connected dApps in the browser and security screens with Solana-specific enrichments.

## External Dependencies

### Mobile/Expo
- `expo-secure-store`: Secure key storage.
- `expo-local-authentication`: Biometric authentication.
- `expo-clipboard`, `expo-haptics`, `expo-web-browser`.

### Cryptography
- `@scure/bip39`, `@scure/bip32`: Mnemonic and HD key derivation.
- `@noble/hashes`, `@noble/ciphers`: Cryptographic hashing and AES-256-GCM.
- `viem`: EVM utilities.
- `@solana/web3.js`, `@solana/spl-token`, `tweetnacl`, `bs58`: Solana interactions.
- `react-native-qrcode-svg`: QR code generation.

### Blockchain Infrastructure
- **Solana RPC**: Paid Helius RPC (with fallback to public Solana RPC).
- **CoinGecko API**: Primary source for major token prices.
- **DexScreener API**: Fallback for long-tail token prices.
- **Jupiter API**: Solana swap quotes and transaction building.
- **Pumpportal.fun API**: For Pump.fun bonding curve trades.

### Database
- **PostgreSQL**: Used with Drizzle ORM.

## Developer Notes

### Cordon Success Fee
- Fee is charged ONLY if swap confirms successfully on-chain
- Fee schedule: Standard (0.0002 SOL), Fast (0.00035 SOL), Turbo (0.0006 SOL)
- Pro users have fee waived; fee is included in reserve calculation
- Failed fee payments are queued and retried on screen focus (max 3 attempts, 30-min intervals)
- Files: `client/constants/successFee.ts`, `client/services/successFeeService.ts`

### Cordon Treasury
- Treasury address configured in `app.config.ts` under `extra.cordonSolTreasury`
- Solana treasury: `6pcN26cpKbWmGyRn8DgRjqRzpBW2CFp8PK5wZ9gTArpE`
- Central accessor: `client/constants/treasury.ts` with OTA-safe fallbacks
- Displayed in Settings screen with Copy and Explorer buttons
- If treasury not configured, success fees are silently skipped

### Contract Security Scanner (CORDON SCAN v2)
- Located in `client/lib/securityScan.ts` and displayed in AssetDetailScreen About tab
- Performs comprehensive on-chain security analysis for Solana tokens
- **Verified On-Chain Checks** (kind: "verified"):
  - Token Program: SPL vs Token-2022 detection
  - Mintable: Checks mintAuthority existence
  - Freezable: Checks freezeAuthority existence
  - Token Extensions (Token-2022): Detects risky extensions (TransferHook, PermanentDelegate, DefaultAccountState, TransferFee, etc.)
  - Metadata Immutability: Reads Metaplex metadata PDA byte 66 for isMutable flag
- **Risk Signals** (kind: "signal"):
  - Holder Concentration: Uses getTokenLargestAccounts to compute top 1/5/10 holder percentages
  - Route Liquidity: Probes Jupiter lite-api for tradability and price impact
- **Status Labels**: "Safe", "Caution", "Warning", "Not supported", "Unable to verify" (never "Unknown")
- **Caching**: Results cached in AsyncStorage with key `cordon_security_scan_{mint}`, 60-minute TTL
- **Rescan**: Manual rescan button ignores cache TTL
- **Footer**: "Verified = on-chain facts. Signals = heuristics, not guarantees."
- Files: `client/lib/securityScan.ts`, `client/screens/AssetDetailScreen.tsx`