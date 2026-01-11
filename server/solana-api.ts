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

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC_URL, "confirmed");

const getRpcProviderName = (url: string): string => {
  if (url.includes("helius")) return "Helius";
  if (url.includes("quicknode")) return "QuickNode";
  if (url.includes("alchemy")) return "Alchemy";
  if (url.includes("mainnet-beta.solana.com")) return "Public RPC";
  return "Custom RPC";
};

console.log("[Solana API] Using RPC:", getRpcProviderName(SOLANA_RPC_URL));

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

export interface SendTransactionResult {
  signature: string;
  status: "confirmed" | "failed";
  error?: string;
}

export async function sendSignedTransaction(
  transactionBase64: string,
  signatureBase64: string,
  publicKeyBase58: string
): Promise<SendTransactionResult> {
  const transactionBuffer = Buffer.from(transactionBase64, "base64");
  const transaction = Transaction.from(transactionBuffer);

  const signature = Buffer.from(signatureBase64, "base64");
  const publicKey = new PublicKey(publicKeyBase58);

  transaction.addSignature(publicKey, signature);

  const txSignature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  try {
    await connection.confirmTransaction(txSignature, "confirmed");
    return { signature: txSignature, status: "confirmed" };
  } catch (confirmError: any) {
    console.log(`[Solana API] Transaction ${txSignature} failed confirmation:`, confirmError.message);
    return { 
      signature: txSignature, 
      status: "failed", 
      error: confirmError.message 
    };
  }
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
  
  console.log(`[Solana History] Fetching signatures for ${address.slice(0, 8)}... limit=${limit}`);
  const signatures = await connection.getSignaturesForAddress(pubkey, { limit });
  console.log(`[Solana History] Found ${signatures.length} signatures`);
  
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
      
      // Collect ALL instructions including inner instructions (CPI calls)
      // SPL token transfers via DEXs/programs are often in innerInstructions
      const allInstructions: any[] = [...instructions];
      
      // Add inner instructions (CPI calls from programs like Jupiter, pump.fun, etc.)
      if (tx.meta.innerInstructions) {
        for (const inner of tx.meta.innerInstructions) {
          if (inner.instructions) {
            allInstructions.push(...inner.instructions);
          }
        }
      }
      
      // Track SOL transfer separately - SPL token transfers take priority
      let solTransfer: { amount: string; from: string; to: string; type: "send" | "receive" } | null = null;
      let splTransferFound = false;
      
      // Helper function to process SPL transfer instruction
      const processSplTransfer = async (ix: any): Promise<boolean> => {
        if (!("parsed" in ix) || ix.program !== "spl-token") return false;
        if (ix.parsed?.type !== "transfer" && ix.parsed?.type !== "transferChecked") return false;
        
        const info = ix.parsed.info;
        const sourceOwner = info.authority || info.source;
        const destOwner = info.destination;
        
        // For transferChecked, mint is in info.mint
        // For regular transfer, we need to look it up from the token account
        tokenMint = info.mint;
        
        // Resolve mint from token account FIRST (needed for regular 'transfer' instructions)
        if (!tokenMint && info.source) {
          try {
            const tokenAcct = await connection.getParsedAccountInfo(new PublicKey(info.source));
            if (tokenAcct.value?.data && "parsed" in tokenAcct.value.data) {
              tokenMint = tokenAcct.value.data.parsed.info.mint;
            }
          } catch {}
        }
        
        if (info.tokenAmount) {
          // transferChecked has tokenAmount with UI values
          amount = info.tokenAmount.uiAmountString || info.tokenAmount.uiAmount?.toString();
        } else if (info.amount) {
          // Regular transfer only has raw amount - need to convert using decimals
          if (tokenMint) {
            try {
              const mintInfo = await connection.getParsedAccountInfo(new PublicKey(tokenMint));
              let decimals = 9;
              if (mintInfo.value?.data && "parsed" in mintInfo.value.data) {
                decimals = mintInfo.value.data.parsed.info.decimals;
              }
              const rawAmount = BigInt(info.amount);
              const divisor = BigInt(10 ** decimals);
              const uiAmount = Number(rawAmount) / Number(divisor);
              amount = uiAmount.toString();
              console.log(`[Solana History] Converted SPL amount: ${info.amount} -> ${amount} (${decimals} decimals)`);
            } catch (e) {
              console.error(`[Solana History] Failed to get decimals for mint ${tokenMint}:`, e);
              amount = info.amount;
            }
          } else {
            console.log(`[Solana History] No mint found for transfer, using raw amount: ${info.amount}`);
            amount = info.amount;
          }
        }
        
        // Fetch token metadata for symbol
        if (tokenMint) {
          try {
            const metadata = await getSplTokenMetadata(tokenMint);
            if (metadata?.symbol) {
              tokenSymbol = metadata.symbol;
            } else {
              tokenSymbol = tokenMint.slice(0, 4).toUpperCase();
            }
          } catch {
            tokenSymbol = tokenMint.slice(0, 4).toUpperCase();
          }
        }
        
        from = sourceOwner;
        to = destOwner;
        
        if (sourceOwner === address) {
          type = "send";
        } else {
          type = "receive";
        }
        
        return true;
      };
      
      // First pass: look for SPL token transfers in ALL instructions
      for (const ix of allInstructions) {
        if (await processSplTransfer(ix)) {
          splTransferFound = true;
          break;
        }
      }
      
      // Second pass: if no SPL transfer found, look for SOL transfers
      if (!splTransferFound) {
        for (const ix of allInstructions) {
          if ("parsed" in ix && ix.program === "system" && ix.parsed?.type === "transfer") {
            const info = ix.parsed.info;
            const lamports = info.lamports || 0;
            
            // Skip tiny amounts that are just fees (less than 0.0001 SOL = 100000 lamports)
            if (lamports < 100000) continue;
            
            const solAmount = (lamports / LAMPORTS_PER_SOL).toString();
            let solType: "send" | "receive" = "send";
            
            if (info.source === address) {
              solType = "send";
            } else if (info.destination === address) {
              solType = "receive";
            }
            
            solTransfer = {
              amount: solAmount,
              from: info.source,
              to: info.destination,
              type: solType,
            };
            break;
          }
        }
        
        if (solTransfer) {
          amount = solTransfer.amount;
          tokenSymbol = "SOL";
          from = solTransfer.from;
          to = solTransfer.to;
          type = solTransfer.type;
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

export interface SolanaFeeEstimate {
  lamports: number;
  sol: string;
  formatted: string;
}

export interface TokenAccountWithDelegate {
  pubkey: string;
  mint: string;
  owner: string;
  delegate: string | null;
  delegatedAmount: string;
  decimals: number;
  state: string;
}

export async function getTokenAccountsWithDelegates(address: string): Promise<TokenAccountWithDelegate[]> {
  const pubkey = new PublicKey(address);
  
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
    programId: TOKEN_PROGRAM_ID,
  });
  
  const result: TokenAccountWithDelegate[] = [];
  
  for (const account of tokenAccounts.value) {
    const info = account.account.data.parsed?.info;
    if (!info) continue;
    
    result.push({
      pubkey: account.pubkey.toBase58(),
      mint: info.mint,
      owner: info.owner,
      delegate: info.delegate || null,
      delegatedAmount: info.delegatedAmount?.amount || "0",
      decimals: info.tokenAmount?.decimals || 0,
      state: info.state,
    });
  }
  
  return result;
}

export interface PreparedRevokeDelegate {
  transaction: string;
  tokenAccount: string;
}

export async function prepareRevokeDelegateTransaction(
  tokenAccountAddress: string,
  ownerAddress: string
): Promise<PreparedRevokeDelegate> {
  const { createRevokeInstruction } = await import("@solana/spl-token");
  
  const tokenAccountPubkey = new PublicKey(tokenAccountAddress);
  const ownerPubkey = new PublicKey(ownerAddress);
  
  const revokeInstruction = createRevokeInstruction(
    tokenAccountPubkey,
    ownerPubkey
  );
  
  const transaction = new Transaction().add(revokeInstruction);
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = ownerPubkey;
  
  const serialized = transaction.serialize({ requireAllSignatures: false });
  const base64 = Buffer.from(serialized).toString("base64");
  
  return {
    transaction: base64,
    tokenAccount: tokenAccountAddress,
  };
}

export async function sendRawTransaction(transactionBase64: string): Promise<{
  signature: string;
  status: string;
}> {
  const txBuffer = Buffer.from(transactionBase64, "base64");
  
  const signature = await connection.sendRawTransaction(txBuffer, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  
  const confirmation = await connection.confirmTransaction(signature, "confirmed");
  
  return {
    signature,
    status: confirmation.value.err ? "failed" : "confirmed",
  };
}

export async function estimateSolanaFee(isToken: boolean = false): Promise<SolanaFeeEstimate> {
  try {
    const { feeCalculator } = await connection.getRecentBlockhash();
    let baseFee = feeCalculator?.lamportsPerSignature || 5000;
    
    if (isToken) {
      baseFee = baseFee * 2 + 2039280;
    }
    
    const sol = baseFee / LAMPORTS_PER_SOL;
    let formatted: string;
    
    if (sol < 0.0001) {
      formatted = `~${(sol * 1000000).toFixed(0)} microSOL`;
    } else if (sol < 0.001) {
      formatted = `~${sol.toFixed(6)} SOL`;
    } else {
      formatted = `~${sol.toFixed(4)} SOL`;
    }
    
    return {
      lamports: baseFee,
      sol: sol.toFixed(9),
      formatted,
    };
  } catch (error) {
    console.error("[Solana] Fee estimation error:", error);
    const defaultFee = isToken ? 2049280 : 5000;
    const sol = defaultFee / LAMPORTS_PER_SOL;
    return {
      lamports: defaultFee,
      sol: sol.toFixed(9),
      formatted: isToken ? "~0.002 SOL" : "~0.000005 SOL",
    };
  }
}
