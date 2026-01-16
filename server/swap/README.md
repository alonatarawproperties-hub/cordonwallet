# Cordon Swap API

Server-assisted Solana swap module. **Non-custodial**: keys never leave the client device; server never signs.

## Architecture

1. Client calls server for **Quote** + **Build Swap Transaction** (unsigned)
2. Client runs local security preview + signs locally
3. Client sends **signed tx** to server for broadcast via dual RPC (Helius + fallback)

## Endpoints

### Token List
```
GET /api/swap/solana/tokens?query=&limit=50
```
Returns token list with search/filter. Empty query returns popular tokens.

### Single Token Lookup
```
GET /api/swap/solana/token/:mint
```

### Quote (Jupiter)
```
GET /api/swap/solana/quote?inputMint=...&outputMint=...&amount=...&slippageBps=50
```
Returns: `{ ok, route, quote, normalized: { outAmount, minOut, priceImpactPct, routePlan } }`

### Build Jupiter Swap TX
```
POST /api/swap/solana/build
Body: { userPublicKey, quote, speedMode, maxPriorityFeeLamports?, wrapAndUnwrapSol? }
```
Returns: `{ ok, route, swapTransactionBase64, lastValidBlockHeight, prioritizationFeeLamports }`

### Build Pump (Bonding Curve) TX
```
POST /api/swap/solana/pump/build
Body: { userPublicKey, mint, side, amountSol?, amountTokens?, slippageBps?, speedMode }
```

### Send Signed TX
```
POST /api/swap/solana/send
Body: { signedTransactionBase64, mode }
```
Returns: `{ ok, signature, rpc }`

### Check TX Status
```
GET /api/swap/solana/status?sig=...
```

## Speed Modes

| Mode     | Priority Fee Cap | Retries | Timeout |
|----------|-----------------|---------|---------|
| standard | 200,000 lamports | 2 | 6s |
| fast     | 1,000,000 lamports | 4 | 12s |
| turbo    | 3,000,000 lamports | 6 | 20s |

## Environment Variables

```env
SOLANA_RPC_URL=<helius https url>              # Primary RPC
SOLANA_RPC_URL_FALLBACK=<triton https url>     # Fallback RPC
JUPITER_BASE_URL=https://quote-api.jup.ag
JUPITER_QUOTE_PATH=/v6/quote
JUPITER_SWAP_PATH=/v6/swap
JUPITER_TIMEOUT_MS=8000
SWAP_TOKENLIST_PRIMARY=https://token.jup.ag/strict
SWAP_TOKENLIST_FALLBACK=https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json
TOKENLIST_TTL_MS=21600000
PUMP_MODE_ENABLED=true
PUMPPORTAL_BASE_URL=https://pumpportal.fun
PUMPPORTAL_API_KEY=
MAX_BODY_BYTES=2000000
```

## Test Checklist

1. ✅ Quote SOL->USDC via `/api/swap/solana/quote` (200)
2. ✅ Build Jupiter tx via `/api/swap/solana/build` (returns base64)
3. ✅ Client decodes without Buffer error
4. ✅ Client signs and POST `/api/swap/solana/send` returns signature
5. ✅ Pump test: force NO_ROUTE then `/api/swap/solana/pump/build` returns base64
6. ✅ Token list endpoint returns results even if upstream is down

## Client Flow

```
1. GET /api/swap/solana/quote
2. POST /api/swap/solana/build (or pump/build if NO_ROUTE)
3. Deserialize tx, run drainer detection
4. Sign locally with keypair or WalletConnect
5. POST /api/swap/solana/send
6. Poll /api/swap/solana/status or display explorer link
```
