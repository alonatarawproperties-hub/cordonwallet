/**
 * Create ATAs (Associated Token Accounts) for Cordon treasury wallet.
 *
 * These ATAs are needed for Jupiter platform fees to work.
 * Each ATA costs ~0.002 SOL in rent (one-time).
 *
 * Usage:
 *   npx ts-node scripts/create-treasury-atas.ts <PAYER_KEYPAIR_PATH>
 *
 * Example:
 *   npx ts-node scripts/create-treasury-atas.ts ~/.config/solana/id.json
 *
 * The payer can be ANY funded wallet - it doesn't have to be the treasury.
 * The ATAs will be owned by the treasury wallet.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";

const TREASURY_WALLET = "J23SHFtAW79DRKxGFeogFYCXi3oNRBDFfJKss1dfaNi2";

// Top tokens to create ATAs for (cover ~95%+ of swap volume)
const MINTS = {
  WSOL:   "So11111111111111111111111111111111111111112",
  USDC:   "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT:   "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  JUP:    "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  BONK:   "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF:    "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  JITOSOL:"J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  RAY:    "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  ORCA:   "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
};

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

async function main() {
  const keypairPath = process.argv[2];
  if (!keypairPath) {
    console.error("Usage: npx ts-node scripts/create-treasury-atas.ts <PAYER_KEYPAIR_PATH>");
    console.error("Example: npx ts-node scripts/create-treasury-atas.ts ~/.config/solana/id.json");
    process.exit(1);
  }

  // Load payer keypair
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log("Payer:", payer.publicKey.toBase58());

  const connection = new Connection(RPC_URL, "confirmed");
  const treasuryPubkey = new PublicKey(TREASURY_WALLET);

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Payer balance: ${(balance / 1e9).toFixed(4)} SOL`);
  console.log(`Treasury: ${TREASURY_WALLET}`);
  console.log("---");

  let created = 0;
  let skipped = 0;

  for (const [symbol, mint] of Object.entries(MINTS)) {
    const mintPubkey = new PublicKey(mint);
    const ata = getAssociatedTokenAddressSync(mintPubkey, treasuryPubkey);

    // Check if ATA already exists
    const accountInfo = await connection.getAccountInfo(ata);
    if (accountInfo) {
      console.log(`[SKIP] ${symbol.padEnd(8)} ATA already exists: ${ata.toBase58()}`);
      skipped++;
      continue;
    }

    console.log(`[CREATE] ${symbol.padEnd(8)} ATA: ${ata.toBase58()}`);

    try {
      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,    // payer
          ata,                // ATA address
          treasuryPubkey,     // owner (treasury)
          mintPubkey,         // mint
          TOKEN_PROGRAM_ID,
        )
      );

      const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: "confirmed",
      });
      console.log(`  -> TX: ${sig}`);
      created++;
    } catch (err: any) {
      console.error(`  -> FAILED: ${err.message}`);
    }
  }

  console.log("---");
  console.log(`Done. Created: ${created}, Skipped (already exist): ${skipped}`);
  console.log(`Total rent cost: ~${(created * 0.00203928).toFixed(4)} SOL`);
}

main().catch(console.error);
