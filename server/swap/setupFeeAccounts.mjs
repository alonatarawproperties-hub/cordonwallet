/**
 * Setup Fee Accounts — Creates ATAs on the treasury wallet for fee collection.
 *
 * Run from shell:
 *   node server/swap/setupFeeAccounts.mjs
 *
 * Requires:
 *   - HELIUS_API_KEY (or SOLANA_RPC_URL) in env
 *   - FEE_PAYER_PRIVATE_KEY in env (any wallet with ~0.01 SOL to pay rent)
 *
 * Each ATA costs ~0.00203 SOL in rent. 3 ATAs = ~0.006 SOL total.
 */

import { Connection, PublicKey, Keypair, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";

const TREASURY_WALLET = "J23SHFtAW79DRKxGFeogFYCXi3oNRBDFfJKss1dfaNi2";

const FEE_TOKENS = [
  { symbol: "WSOL", mint: "So11111111111111111111111111111111111111112" },
  { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
];

function getRpcUrl() {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY) return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  throw new Error("Set HELIUS_API_KEY or SOLANA_RPC_URL in env");
}

async function main() {
  const rpcUrl = getRpcUrl();
  console.log("RPC:", rpcUrl.includes("helius") ? "Helius" : rpcUrl.slice(0, 40));

  const connection = new Connection(rpcUrl, "confirmed");
  const treasuryPubkey = new PublicKey(TREASURY_WALLET);

  console.log(`\nTreasury: ${TREASURY_WALLET}`);
  console.log("Checking existing ATAs...\n");

  const missing = [];

  for (const token of FEE_TOKENS) {
    const mintPubkey = new PublicKey(token.mint);
    const ata = await getAssociatedTokenAddress(mintPubkey, treasuryPubkey);
    const account = await connection.getAccountInfo(ata);

    if (account) {
      console.log(`  OK  ${token.symbol} ATA exists: ${ata.toBase58()}`);
    } else {
      console.log(`  --  ${token.symbol} ATA missing: ${ata.toBase58()}`);
      missing.push({ symbol: token.symbol, mint: mintPubkey, ata });
    }
  }

  if (missing.length === 0) {
    console.log("\nAll fee ATAs exist! Platform fees are ready to collect.");
    return;
  }

  console.log(`\n${missing.length} ATA(s) need to be created.`);

  const payerKey = process.env.FEE_PAYER_PRIVATE_KEY;
  if (!payerKey) {
    console.log("\nTo create them, add FEE_PAYER_PRIVATE_KEY to environment secrets");
    console.log("(any wallet with ~0.01 SOL — base58 private key).");
    console.log("Then re-run: node server/swap/setupFeeAccounts.mjs");
    return;
  }

  let payer;
  try {
    const decoded = bs58.decode(payerKey);
    payer = Keypair.fromSecretKey(decoded);
  } catch {
    console.error("Invalid FEE_PAYER_PRIVATE_KEY — must be base58-encoded private key");
    return;
  }

  const payerBalance = await connection.getBalance(payer.publicKey);
  console.log(`\nPayer: ${payer.publicKey.toBase58()} (${(payerBalance / 1e9).toFixed(4)} SOL)`);

  const rentNeeded = missing.length * 0.00203;
  if (payerBalance < rentNeeded * 1e9) {
    console.error(`Not enough SOL. Need ~${rentNeeded.toFixed(4)} SOL, have ${(payerBalance / 1e9).toFixed(4)}`);
    return;
  }

  const tx = new Transaction();

  for (const { symbol, mint, ata } of missing) {
    console.log(`Adding: create ${symbol} ATA`);
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ata,
        treasuryPubkey,
        mint,
      )
    );
  }

  console.log("\nSending transaction...");
  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    console.log(`Sent: ${sig}`);
    console.log("Waiting for confirmation...");

    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    console.log(`\nDone! Created ${missing.length} ATA(s). Platform fees are now active.`);
  } catch (err) {
    console.error("\nTransaction failed:", err.message || err);
    if (err.logs) {
      console.error("Logs:", err.logs.join("\n"));
    }
  }
}

main().catch(console.error);
