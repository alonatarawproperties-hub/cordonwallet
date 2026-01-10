import {
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  Keypair,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { getSolanaConnection, getSolanaExplorerTxUrl } from "./client";
import { deriveSolanaKeypair } from "./keys";

export interface SendSolResult {
  signature: string;
  explorerUrl: string;
}

export interface SendSplResult {
  signature: string;
  explorerUrl: string;
}

export async function sendSol(
  mnemonic: string,
  toAddress: string,
  amountSol: string
): Promise<SendSolResult> {
  const connection = getSolanaConnection();
  const { keypair: senderKeypair } = deriveSolanaKeypair(mnemonic);
  const recipientPubkey = new PublicKey(toAddress);
  
  const lamports = Math.floor(parseFloat(amountSol) * LAMPORTS_PER_SOL);
  
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: senderKeypair.publicKey,
      toPubkey: recipientPubkey,
      lamports,
    })
  );
  
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = senderKeypair.publicKey;
  
  const signature = await sendAndConfirmTransaction(connection, transaction, [senderKeypair], {
    commitment: "confirmed",
  });
  
  return {
    signature,
    explorerUrl: getSolanaExplorerTxUrl(signature),
  };
}

export async function sendSplToken(
  mnemonic: string,
  mintAddress: string,
  toAddress: string,
  amount: string,
  decimals: number
): Promise<SendSplResult> {
  const connection = getSolanaConnection();
  const { keypair: senderKeypair } = deriveSolanaKeypair(mnemonic);
  const recipientPubkey = new PublicKey(toAddress);
  const mintPubkey = new PublicKey(mintAddress);
  
  const senderAta = await getOrCreateAssociatedTokenAccount(
    connection,
    senderKeypair,
    mintPubkey,
    senderKeypair.publicKey
  );
  
  const recipientAta = await getOrCreateAssociatedTokenAccount(
    connection,
    senderKeypair,
    mintPubkey,
    recipientPubkey
  );
  
  const amountInBaseUnits = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, decimals)));
  
  const transaction = new Transaction().add(
    createTransferInstruction(
      senderAta.address,
      recipientAta.address,
      senderKeypair.publicKey,
      amountInBaseUnits
    )
  );
  
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = senderKeypair.publicKey;
  
  const signature = await sendAndConfirmTransaction(connection, transaction, [senderKeypair], {
    commitment: "confirmed",
  });
  
  return {
    signature,
    explorerUrl: getSolanaExplorerTxUrl(signature),
  };
}

export async function estimateSolTransferFee(): Promise<number> {
  const connection = getSolanaConnection();
  const { blockhash } = await connection.getLatestBlockhash();
  const feeCalculator = await connection.getFeeForMessage(
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: PublicKey.default,
        toPubkey: PublicKey.default,
        lamports: 0,
      })
    ).compileMessage()
  );
  return feeCalculator.value || 5000;
}
