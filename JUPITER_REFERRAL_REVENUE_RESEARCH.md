# Jupiter Referral Revenue Research for Cordon

## Executive Summary

Cordon already has **most of the Jupiter referral infrastructure built** but it is **currently disabled** via a kill-switch (`FORCE_DISABLE_JUPITER_PLATFORM_FEES = true` in `server/swap/jupiter.ts:7`) due to an unresolved `0x1788` error. This document covers the full Jupiter referral/fee landscape, what Cordon already has, what's missing, and how to activate revenue.

---

## Current State in Cordon

### What Already Exists

| Component | File | Status |
|---|---|---|
| Referral Program ID | `server/swap/jupiter.ts:24` | Defined: `REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3` |
| Fee account PDA derivation | `server/swap/jupiter.ts:35-60` | Implemented (seeds: `referral_ata` + referralAccount + mint) |
| `platformFeeBps` on `/quote` | `server/swap/jupiter.ts:179-182` | Implemented but guarded by kill-switch |
| `feeAccount` on `/swap` | `server/swap/jupiter.ts:301-394` | Stripped by `sanitizeQuoteForSwap()` |
| Fee config env vars | `server/swap/config.ts:4-10` | `CORDON_PLATFORM_FEE_ENABLED`, `CORDON_PLATFORM_FEE_BPS` (default 50 = 0.5%), `CORDON_REFERRAL_ACCOUNT` |
| Output fee (post-swap transfer) | `client/lib/solana/outputFee.ts` | Active: 100 bps (1%) transfer to treasury |
| Success fee (per-swap fixed) | `client/constants/successFee.ts` | Active: 0.00020-0.00060 SOL per swap |
| Treasury wallet | `server/swap/config.ts:1` | `6pcN26cpKbWmGyRn8DgRjqRzpBW2CFp8PK5wZ9gTArpE` |
| Kill-switch | `server/swap/jupiter.ts:7` | `FORCE_DISABLE_JUPITER_PLATFORM_FEES = true` |
| 0x1788 retry logic | `server/swap/jupiter.ts:352-401` | Falls back to no-fee quote on fee account errors |

### What's Blocking Revenue

1. **Kill-switch is ON** - `FORCE_DISABLE_JUPITER_PLATFORM_FEES = true`
2. **No referral account created on-chain** - `CORDON_REFERRAL_ACCOUNT` env var is empty
3. **No referral token accounts initialized** - PDAs for SOL/USDC/USDT not created on Solana
4. **The 0x1788 error** - This is Jupiter's custom program error 6024, meaning the fee account passed to the swap doesn't exist or has wrong authority

---

## Jupiter Fee Options (Three Approaches)

### Option A: Metis Swap API Platform Fees (Current Architecture)

This is what Cordon is already wired for. Uses the standard `/swap/v1/quote` and `/swap/v1/swap` endpoints.

**How it works:**
1. Pass `platformFeeBps=50` on the `/quote` request
2. Jupiter returns a quote that accounts for the fee (user sees slightly less output)
3. Pass `feeAccount=<your_token_account>` on the `/swap` request
4. Jupiter's program routes the fee to your account atomically

**Revenue split: You keep 100%** (Jupiter takes 0%)

**Requirements:**
- As of January 2025, you do NOT need the Referral Program for Metis API
- You just need a valid token account for the fee mint
- The `feeAccount` mint must match either the input or output mint (ExactIn: either; ExactOut: input only)

**Cordon-specific notes:**
- This is the simplest path since the code already exists
- The 0x1788 error happened because the referral token accounts were never initialized on-chain
- Fix: Create the accounts, OR use regular ATAs instead of referral PDAs

### Option B: Ultra Swap API Integrator Fees (New Architecture)

Jupiter's newer Ultra API provides managed execution (they handle sending the transaction).

**How it works:**
1. Pass `referralAccount` + `referralFee` on `/ultra/v1/order`
2. Jupiter handles tx building and execution
3. Fee is deducted and routed to your referral token account

**Revenue split: You keep 80%** (Jupiter takes 20%)

**Requirements:**
- Must register a referral account via the Referral Program (`REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3`)
- Must create referral token accounts for each mint you want fees in
- Install `@jup-ag/referral-sdk`

**Tradeoffs:**
- Simpler execution (Jupiter sends the tx)
- Less control over transaction building
- 20% fee to Jupiter
- Different API surface (would require refactoring swap flow)

### Option C: jup.ag Referral Links (Not Applicable)

For web-based jup.ag integrations only. Not relevant for Cordon's in-app swap.

---

## Recommended Path: Fix Option A (Metis API Platform Fees)

Since Cordon already has the Metis API integration built, the fastest path to revenue is fixing the existing implementation.

### Step 1: Create a Referral Account On-Chain

Go to https://referral.jup.ag/ and connect the Cordon treasury wallet (`6pcN26cpKbWmGyRn8DgRjqRzpBW2CFp8PK5wZ9gTArpE`). Create a referral account. Note the referral public key.

**OR** do it programmatically:

```typescript
import { ReferralProvider } from "@jup-ag/referral-sdk";
import { Connection, Keypair } from "@solana/web3.js";

const connection = new Connection("YOUR_RPC_URL");
const provider = new ReferralProvider(connection);

// Use treasury wallet keypair
const wallet = Keypair.fromSecretKey(/* treasury secret key */);

const { tx, referralAccountPubKey } = await provider.initializeReferralAccountWithName({
  payerPubKey: wallet.publicKey,
  partnerPubKey: wallet.publicKey,
  projectPubKey: new PublicKey("45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp"), // Jupiter Swap project
  name: "cordon",
});

await sendAndConfirmTransaction(connection, tx, [wallet]);
console.log("Referral account:", referralAccountPubKey.toBase58());
```

### Step 2: Initialize Referral Token Accounts

Create token accounts for the most common output mints. At minimum:

| Token | Mint Address |
|---|---|
| SOL (WSOL) | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |

```typescript
for (const mint of [WSOL_MINT, USDC_MINT, USDT_MINT]) {
  const { tx, referralTokenAccountPubKey } = await provider.initializeReferralTokenAccount({
    payerPubKey: wallet.publicKey,
    referralAccountPubKey: referralAccount,
    mint: new PublicKey(mint),
  });

  const existing = await connection.getAccountInfo(referralTokenAccountPubKey);
  if (!existing) {
    await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log(`Token account for ${mint}: ${referralTokenAccountPubKey.toBase58()}`);
  }
}
```

### Step 3: Configure Environment Variables

```bash
CORDON_PLATFORM_FEE_ENABLED=true
CORDON_PLATFORM_FEE_BPS=50          # 0.5% fee
CORDON_REFERRAL_ACCOUNT=<referral_account_pubkey_from_step_1>
```

### Step 4: Remove the Kill-Switch

In `server/swap/jupiter.ts:7`, change:

```typescript
// BEFORE
const FORCE_DISABLE_JUPITER_PLATFORM_FEES = true;

// AFTER
const FORCE_DISABLE_JUPITER_PLATFORM_FEES = false;
```

### Step 5: Re-enable feeAccount in Swap Requests

The current code in `server/routes.ts:41-50` strips `feeAccount` from all swap requests. The `buildSwapTransaction` in `server/swap/jupiter.ts:326` also never includes fee fields.

Changes needed:
1. In `server/swap/jupiter.ts` `buildSwapTransaction()`: When `platformFeesAllowed()` is true, resolve the fee account and include it in the swap body
2. In `server/routes.ts` `normalizeJupiterSwapParams()`: Only strip `feeAccount` when platform fees are disabled, not unconditionally

### Step 6: Handle the 0x1788 Error Properly

The `0x1788` / custom program error 6024 means the fee token account doesn't exist on-chain. The fix is:

1. **Pre-check**: Before including `feeAccount`, verify the PDA exists on-chain (already implemented in `getPlatformFeeParams()` lines 112-134)
2. **Lazy initialization**: If the fee account doesn't exist for a given mint, skip fees for that swap (already handled - returns `null`)
3. **Fallback**: The retry logic at lines 352-391 already handles this gracefully

### Step 7: Test on Devnet First

Before going live:
1. Set up referral account on devnet
2. Initialize token accounts for test mints
3. Execute swaps and verify fees arrive in referral token accounts
4. Test the claim flow

---

## Alternative/Simpler Approach: Skip Referral PDAs Entirely

Since January 2025, Jupiter's Metis Swap API no longer requires the Referral Program. You can pass **any valid token account** as `feeAccount`. This means:

1. Create regular ATAs (Associated Token Accounts) owned by the treasury wallet for WSOL, USDC, USDT
2. Pass these ATAs directly as `feeAccount`
3. No referral program interaction needed
4. No PDA derivation needed
5. Fees go directly to your treasury wallet's token accounts

**This avoids the 0x1788 error entirely** because regular ATAs are simple to create and verify.

### Implementation:

```typescript
// Instead of deriving referral PDAs:
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const treasuryPubkey = new PublicKey(CORDON_TREASURY_WALLET);
const mintPubkey = new PublicKey(outputMint);

// Regular ATA - guaranteed to work if initialized
const feeAccount = getAssociatedTokenAddressSync(mintPubkey, treasuryPubkey);
```

**This is the recommended approach** since it's simpler, avoids the referral program complexity, and you keep 100% of fees.

---

## Revenue Projections

### Platform Fee Revenue (Option A - Metis API)

| Fee Rate | Per $100 Swap | Monthly (at $1M volume) | Monthly (at $10M volume) |
|---|---|---|---|
| 25 bps (0.25%) | $0.25 | $2,500 | $25,000 |
| 50 bps (0.50%) | $0.50 | $5,000 | $50,000 |
| 100 bps (1.00%) | $1.00 | $10,000 | $100,000 |

### Current Revenue Streams (Already Active)

| Fee Type | Rate | Description |
|---|---|---|
| Output Fee | 100 bps (1%) | Post-swap transfer to treasury (client-side) |
| Success Fee | 0.00020-0.00060 SOL | Fixed per-swap fee (speed-dependent) |

### Combined Revenue (Platform Fee + Existing Fees)

Adding a 50 bps Jupiter platform fee ON TOP of the existing output fee would mean:
- **1.5% total take rate** per swap (1% output fee + 0.5% platform fee)
- Consider whether this is competitive. Many aggregators charge 0.5-1% total.
- **Recommendation**: If enabling Jupiter platform fees, consider reducing the output fee to maintain competitiveness.

---

## Fee Claiming

Fees accumulated in referral token accounts must be claimed periodically:

```typescript
// Using the referral SDK
const provider = new ReferralProvider(connection);

// Claim single token
const { tx } = await provider.claim({
  payerPubKey: wallet.publicKey,
  referralAccountPubKey: referralAccount,
  mint: new PublicKey(USDC_MINT),
});

// Or claim all (batched by 5 per transaction)
const { txs } = await provider.claimAllV2({
  payerPubKey: wallet.publicKey,
  referralAccountPubKey: referralAccount,
});
```

If using the **simpler ATA approach** (no referral program), fees go directly to your treasury ATAs - no claiming needed.

---

## Action Items Checklist

- [ ] **Decision**: Choose approach (Referral PDAs vs Simple ATAs vs Ultra API)
- [ ] **Decision**: Set fee rate (recommend 25-50 bps to stay competitive alongside existing 1% output fee)
- [ ] **On-chain**: Create referral account OR treasury ATAs for WSOL/USDC/USDT
- [ ] **Config**: Set `CORDON_REFERRAL_ACCOUNT` (or treasury ATA addresses) in env
- [ ] **Config**: Set `CORDON_PLATFORM_FEE_ENABLED=true`
- [ ] **Code**: Remove kill-switch (`FORCE_DISABLE_JUPITER_PLATFORM_FEES = false`)
- [ ] **Code**: Re-enable `feeAccount` parameter in swap build requests
- [ ] **Code**: Update `normalizeJupiterSwapParams()` to conditionally allow `feeAccount`
- [ ] **Test**: Validate on devnet/staging
- [ ] **Test**: Verify 0x1788 error is resolved
- [ ] **Monitor**: Set up alerts for fee account errors
- [ ] **Revenue**: If using referral program, set up periodic claiming (or use ATAs for direct deposit)
- [ ] **Consider**: Adjust output fee (currently 1%) to keep total take rate competitive

---

## Key Links

- Jupiter Referral Dashboard: https://referral.jup.ag/
- Jupiter Swap API Docs (Adding Fees): https://dev.jup.ag/docs/swap-api/add-fees-to-swap
- Jupiter Ultra API Docs (Adding Fees): https://dev.jup.ag/docs/ultra/add-fees-to-ultra
- Referral Program GitHub: https://github.com/TeamRaccoons/referral
- Referral SDK: `@jup-ag/referral-sdk` on npm
- Jupiter API Referral Example: https://github.com/jup-ag/jupiter-api-referral-example
- On-chain Program: `REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3` on Solscan
