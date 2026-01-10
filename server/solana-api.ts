import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  Keypair,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  AccountLayout,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";

const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC_URL, "confirmed");

export interface SolBalance {
  lamports: number;
  sol: string;
}

export interface SplTokenBalance {
  mint: string;
  tokenAccount: string;
  amount: string;
  decimals: number;
  uiAmount: number;
  symbol?: string;
  name?: string;
}

export interface SplTokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  logoUri?: string;
}

export interface SolanaPortfolio {
  nativeBalance: SolBalance;
  tokens: SplTokenBalance[];
}

export async function getSolanaBalance(address: string): Promise<SolBalance> {
  const pubkey = new PublicKey(address);
  const lamports = await connection.getBalance(pubkey);
  return {
    lamports,
    sol: (lamports / LAMPORTS_PER_SOL).toFixed(9),
  };
}

export async function getSolanaTokenBalances(address: string): Promise<SplTokenBalance[]> {
  const pubkey = new PublicKey(address);
  
  const tokenAccounts = await connection.getTokenAccountsByOwner(pubkey, {
    programId: TOKEN_PROGRAM_ID,
  });
  
  const balances: SplTokenBalance[] = [];
  
  for (const { pubkey: tokenAccountPubkey, account } of tokenAccounts.value) {
    try {
      const accountData = AccountLayout.decode(account.data);
      const amount = accountData.amount.toString();
      
      if (amount === "0") continue;
      
      const mintAddress = new PublicKey(accountData.mint).toBase58();
      
      let decimals = 9;
      try {
        const mintInfo = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
        if (mintInfo.value?.data && "parsed" in mintInfo.value.data) {
          decimals = mintInfo.value.data.parsed.info.decimals;
        }
      } catch {}
      
      const uiAmount = Number(amount) / Math.pow(10, decimals);
      
      balances.push({
        mint: mintAddress,
        tokenAccount: tokenAccountPubkey.toBase58(),
        amount,
        decimals,
        uiAmount,
      });
    } catch (error) {
      console.error("Error parsing token account:", error);
    }
  }
  
  return balances;
}

export async function getSolanaPortfolio(address: string): Promise<SolanaPortfolio> {
  const [nativeBalance, tokens] = await Promise.all([
    getSolanaBalance(address),
    getSolanaTokenBalances(address),
  ]);
  
  return {
    nativeBalance,
    tokens,
  };
}

export async function getSplTokenMetadata(mintAddress: string): Promise<SplTokenMetadata | null> {
  console.log(`[Solana API] Starting metadata fetch for ${mintAddress.slice(0, 8)}...`);
  
  // First try DexScreener API - it's reliable and doesn't need RPC
  try {
    console.log("[Solana API] Trying DexScreener API first...");
    const dexScreenerResponse = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`,
      { headers: { "Accept": "application/json" } }
    );
    
    if (dexScreenerResponse.ok) {
      const dexData = await dexScreenerResponse.json();
      if (dexData.pairs && dexData.pairs.length > 0) {
        const pair = dexData.pairs.find((p: any) => 
          p.baseToken?.address === mintAddress
        ) || dexData.pairs[0];
        
        const tokenInfo = pair.baseToken?.address === mintAddress 
          ? pair.baseToken 
          : pair.quoteToken;
        
        if (tokenInfo && tokenInfo.name && tokenInfo.symbol) {
          console.log(`[Solana API] Found via DexScreener: ${tokenInfo.symbol} (${tokenInfo.name})`);
          return {
            mint: mintAddress,
            name: tokenInfo.name,
            symbol: tokenInfo.symbol,
            decimals: 9, // Default for Solana tokens
            logoUri: pair.info?.imageUrl,
          };
        }
      }
    }
  } catch (dexError) {
    console.log("[Solana API] DexScreener lookup failed:", dexError);
  }
  
  // If DexScreener didn't work, try Solana RPC for basic info
  try {
    console.log("[Solana API] Trying Solana RPC for mint info...");
    const mintPubkey = new PublicKey(mintAddress);
    
    const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
    if (!mintInfo.value?.data || !("parsed" in mintInfo.value.data)) {
      console.log("[Solana API] Invalid mint address - not a valid SPL token");
      return null;
    }
    
    const parsedData = mintInfo.value.data.parsed;
    const decimals = parsedData.info.decimals;
    console.log(`[Solana API] Got decimals from RPC: ${decimals}`);
    
    // Fallback: Try on-chain Metaplex metadata
    try {
      // Metaplex Token Metadata Program ID
      const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
      
      // Derive metadata PDA
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          METADATA_PROGRAM_ID.toBuffer(),
          mintPubkey.toBuffer(),
        ],
        METADATA_PROGRAM_ID
      );
      
      const metadataAccount = await connection.getAccountInfo(metadataPDA);
      if (metadataAccount && metadataAccount.data.length > 0) {
        // Parse Metaplex metadata (simplified parsing)
        const data = metadataAccount.data;
        
        // Skip first byte (key), then read name (32 bytes) and symbol (10 bytes)
        // Name starts at offset 1 + 32 + 32 + 4 = 69, length at 65
        const nameLength = data.readUInt32LE(65);
        const nameBytes = data.slice(69, 69 + Math.min(nameLength, 32));
        const name = nameBytes.toString("utf8").replace(/\0/g, "").trim();
        
        const symbolOffset = 69 + 32 + 4;
        const symbolLength = data.readUInt32LE(symbolOffset - 4);
        const symbolBytes = data.slice(symbolOffset, symbolOffset + Math.min(symbolLength, 10));
        const symbol = symbolBytes.toString("utf8").replace(/\0/g, "").trim();
        
        if (name && symbol) {
          console.log(`[Solana API] Found token via Metaplex: ${symbol}`);
          return {
            mint: mintAddress,
            name,
            symbol,
            decimals,
          };
        }
      }
    } catch (metaplexError) {
      console.log("[Solana API] Metaplex metadata lookup failed");
    }
    
    // Final fallback: return with minimal info
    return {
      mint: mintAddress,
      name: "Unknown Token",
      symbol: mintAddress.slice(0, 4).toUpperCase(),
      decimals,
    };
  } catch (error) {
    console.error("[SolanaAPI] Error fetching token metadata:", error);
    return null;
  }
}

function parseDecimalToBigInt(amountStr: string, decimals: number): bigint {
  const [integerPart, fractionalPart = ""] = amountStr.split(".");
  const paddedFraction = fractionalPart.padEnd(decimals, "0").slice(0, decimals);
  const combined = integerPart + paddedFraction;
  return BigInt(combined);
}

export interface PreparedTransaction {
  transactionBase64: string;
  message: string;
}

export async function prepareSolTransfer(
  fromAddress: string,
  toAddress: string,
  amountSol: string
): Promise<PreparedTransaction> {
  const fromPubkey = new PublicKey(fromAddress);
  const toPubkey = new PublicKey(toAddress);
  const lamports = parseDecimalToBigInt(amountSol, 9);

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports,
    })
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPubkey;

  const message = transaction.serializeMessage();

  return {
    transactionBase64: transaction.serialize({ requireAllSignatures: false }).toString("base64"),
    message: message.toString("base64"),
  };
}

export async function checkAtaExists(
  mintAddress: string,
  ownerAddress: string
): Promise<boolean> {
  const mintPubkey = new PublicKey(mintAddress);
  const ownerPubkey = new PublicKey(ownerAddress);
  const ataAddress = await getAssociatedTokenAddress(mintPubkey, ownerPubkey);

  try {
    await getAccount(connection, ataAddress);
    return true;
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) {
      return false;
    }
    throw error;
  }
}

export interface PrepareSplTransferOptions {
  fromAddress: string;
  toAddress: string;
  mintAddress: string;
  amount: string;
  decimals: number;
  allowCreateAta: boolean;
}

export async function prepareSplTransfer(
  options: PrepareSplTransferOptions
): Promise<PreparedTransaction> {
  const { fromAddress, toAddress, mintAddress, amount, decimals, allowCreateAta } = options;

  const fromPubkey = new PublicKey(fromAddress);
  const toPubkey = new PublicKey(toAddress);
  const mintPubkey = new PublicKey(mintAddress);

  const senderAta = await getAssociatedTokenAddress(mintPubkey, fromPubkey);
  const recipientAta = await getAssociatedTokenAddress(mintPubkey, toPubkey);

  const transaction = new Transaction();

  let recipientAtaExists = false;
  try {
    await getAccount(connection, recipientAta);
    recipientAtaExists = true;
  } catch (error) {
    if (!(error instanceof TokenAccountNotFoundError)) {
      throw error;
    }
  }

  if (!recipientAtaExists) {
    if (!allowCreateAta) {
      throw new Error(
        "Recipient does not have a token account for this token. Creating one requires paying rent (~0.002 SOL)."
      );
    }
    transaction.add(
      createAssociatedTokenAccountInstruction(fromPubkey, recipientAta, toPubkey, mintPubkey)
    );
  }

  const amountInBaseUnits = parseDecimalToBigInt(amount, decimals);

  transaction.add(
    createTransferInstruction(senderAta, recipientAta, fromPubkey, amountInBaseUnits)
  );

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPubkey;

  const message = transaction.serializeMessage();

  return {
    transactionBase64: transaction.serialize({ requireAllSignatures: false }).toString("base64"),
    message: message.toString("base64"),
  };
}

export async function sendSignedTransaction(
  transactionBase64: string,
  signatureBase64: string,
  publicKeyBase58: string
): Promise<string> {
  const transactionBuffer = Buffer.from(transactionBase64, "base64");
  const transaction = Transaction.from(transactionBuffer);

  const signature = Buffer.from(signatureBase64, "base64");
  const publicKey = new PublicKey(publicKeyBase58);

  transaction.addSignature(publicKey, signature);

  const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  await connection.confirmTransaction(txSignature, "confirmed");

  return txSignature;
}

export interface SolanaTransaction {
  signature: string;
  blockTime: number | null;
  slot: number;
  err: any;
  type: "send" | "receive" | "unknown";
  amount?: string;
  tokenSymbol?: string;
  tokenMint?: string;
  from?: string;
  to?: string;
}

export async function getSolanaTransactionHistory(
  address: string,
  limit: number = 20
): Promise<SolanaTransaction[]> {
  const pubkey = new PublicKey(address);
  
  const signatures = await connection.getSignaturesForAddress(pubkey, { limit });
  
  const transactions: SolanaTransaction[] = [];
  
  for (const sig of signatures) {
    try {
      const tx = await connection.getParsedTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });
      
      if (!tx || !tx.meta) continue;
      
      let type: "send" | "receive" | "unknown" = "unknown";
      let amount: string | undefined;
      let tokenSymbol: string | undefined;
      let tokenMint: string | undefined;
      let from: string | undefined;
      let to: string | undefined;
      
      const instructions = tx.transaction.message.instructions;
      
      for (const ix of instructions) {
        if ("parsed" in ix && ix.program === "system" && ix.parsed?.type === "transfer") {
          const info = ix.parsed.info;
          amount = (info.lamports / LAMPORTS_PER_SOL).toString();
          tokenSymbol = "SOL";
          from = info.source;
          to = info.destination;
          
          if (info.source === address) {
            type = "send";
          } else if (info.destination === address) {
            type = "receive";
          }
          break;
        }
        
        if ("parsed" in ix && ix.program === "spl-token") {
          if (ix.parsed?.type === "transfer" || ix.parsed?.type === "transferChecked") {
            const info = ix.parsed.info;
            
            const sourceOwner = info.authority || info.source;
            const destOwner = info.destination;
            
            if (info.tokenAmount) {
              amount = info.tokenAmount.uiAmountString || info.tokenAmount.uiAmount?.toString();
            } else if (info.amount) {
              amount = info.amount;
            }
            
            tokenMint = info.mint;
            from = sourceOwner;
            to = destOwner;
            
            if (sourceOwner === address) {
              type = "send";
            } else {
              type = "receive";
            }
            break;
          }
        }
      }
      
      transactions.push({
        signature: sig.signature,
        blockTime: sig.blockTime ?? null,
        slot: sig.slot,
        err: sig.err,
        type,
        amount,
        tokenSymbol,
        tokenMint,
        from,
        to,
      });
    } catch (error) {
      console.error(`[Solana] Error parsing tx ${sig.signature}:`, error);
      transactions.push({
        signature: sig.signature,
        blockTime: sig.blockTime ?? null,
        slot: sig.slot,
        err: sig.err,
        type: "unknown",
      });
    }
  }
  
  return transactions;
}
