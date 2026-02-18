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

const PRIMARY_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const FALLBACK_RPC_URL = "https://api.mainnet-beta.solana.com";

let currentRpcUrl = PRIMARY_RPC_URL;
let connection = new Connection(currentRpcUrl, "confirmed");
let usingFallback = false;
let fallbackUntil: number | null = null;

const getRpcProviderName = (url: string): string => {
  if (url.includes("helius")) return "Helius";
  if (url.includes("quicknode")) return "QuickNode";
  if (url.includes("alchemy")) return "Alchemy";
  if (url.includes("mainnet-beta.solana.com")) return "Public RPC";
  return "Custom RPC";
};

function switchToFallback() {
  if (!usingFallback && PRIMARY_RPC_URL !== FALLBACK_RPC_URL) {
    console.log("[Solana API] RPC error (rate limit or access issue)! Switching to fallback Public RPC for 5 minutes...");
    currentRpcUrl = FALLBACK_RPC_URL;
    connection = new Connection(currentRpcUrl, "confirmed");
    usingFallback = true;
    fallbackUntil = Date.now() + 5 * 60 * 1000;
  }
}

function checkFallbackExpiry() {
  if (usingFallback && fallbackUntil && Date.now() > fallbackUntil) {
    console.log("[Solana API] Fallback period expired, switching back to primary RPC...");
    currentRpcUrl = PRIMARY_RPC_URL;
    connection = new Connection(currentRpcUrl, "confirmed");
    usingFallback = false;
    fallbackUntil = null;
  }
}

function isRateLimitError(error: any): boolean {
  const errorStr = String(error).toLowerCase();
  const errorMessage = error?.message?.toLowerCase() || "";
  const combined = errorStr + " " + errorMessage;
  
  const isRateLimit = combined.includes("429") || 
         combined.includes("too many requests") || 
         combined.includes("max usage reached") ||
         combined.includes("403") ||
         combined.includes("access forbidden") ||
         combined.includes("rate limit") ||
         combined.includes("quota") ||
         combined.includes("forbidden");
  
  if (isRateLimit) {
    console.log("[Solana API] Detected rate limit/access error:", errorStr.slice(0, 200));
  }
  
  return isRateLimit;
}

console.log("[Solana API] Using RPC:", getRpcProviderName(PRIMARY_RPC_URL));

export function getSolanaConnection(): Connection {
  checkFallbackExpiry();
  return connection;
}

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
  checkFallbackExpiry();
  const pubkey = new PublicKey(address);
  
  try {
    const lamports = await connection.getBalance(pubkey);
    return {
      lamports,
      sol: (lamports / LAMPORTS_PER_SOL).toFixed(9),
    };
  } catch (error) {
    if (isRateLimitError(error)) {
      switchToFallback();
      const lamports = await connection.getBalance(pubkey);
      return {
        lamports,
        sol: (lamports / LAMPORTS_PER_SOL).toFixed(9),
      };
    }
    throw error;
  }
}

// Token-2022 Program ID
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export async function getSolanaTokenBalances(address: string): Promise<SplTokenBalance[]> {
  checkFallbackExpiry();
  const pubkey = new PublicKey(address);
  
  // Query both SPL Token and Token-2022 accounts in parallel
  let splAccounts, token2022Accounts;
  try {
    [splAccounts, token2022Accounts] = await Promise.all([
      connection.getTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
      connection.getTokenAccountsByOwner(pubkey, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);
  } catch (error) {
    if (isRateLimitError(error)) {
      switchToFallback();
      [splAccounts, token2022Accounts] = await Promise.all([
        connection.getTokenAccountsByOwner(pubkey, { programId: TOKEN_PROGRAM_ID }),
        connection.getTokenAccountsByOwner(pubkey, { programId: TOKEN_2022_PROGRAM_ID }),
      ]);
    } else {
      throw error;
    }
  }
  
  // Combine both SPL and Token-2022 accounts
  const allAccounts = [...splAccounts.value, ...token2022Accounts.value];
  console.log(`[Solana API] Found ${splAccounts.value.length} SPL tokens, ${token2022Accounts.value.length} Token-2022 tokens`);
  
  const balances: SplTokenBalance[] = [];
  
  for (const { pubkey: tokenAccountPubkey, account } of allAccounts) {
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
  
  // Store DexScreener results to potentially combine with Metaplex logo
  let dexScreenerResult: { name: string; symbol: string; logoUri?: string } | null = null;
  
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
          dexScreenerResult = {
            name: tokenInfo.name,
            symbol: tokenInfo.symbol,
            logoUri: pair.info?.imageUrl,
          };
          
          // If DexScreener has logo, fetch real decimals from the mint account then return
          if (dexScreenerResult.logoUri) {
            console.log(`[Solana API] DexScreener has logo: ${dexScreenerResult.logoUri.slice(0, 50)}`);
            let decimals = 9;
            try {
              const mintPubkey = new PublicKey(mintAddress);
              const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
              if (mintInfo.value?.data && "parsed" in mintInfo.value.data) {
                decimals = mintInfo.value.data.parsed.info.decimals;
                console.log(`[Solana API] Got real decimals from RPC: ${decimals}`);
              }
            } catch (rpcErr) {
              console.warn("[Solana API] Failed to fetch decimals from RPC, defaulting to 9");
            }
            return {
              mint: mintAddress,
              name: dexScreenerResult.name,
              symbol: dexScreenerResult.symbol,
              decimals,
              logoUri: dexScreenerResult.logoUri,
            };
          }
          // Otherwise, continue to try Helius DAS API for the logo
          console.log("[Solana API] DexScreener has no logo, will try Helius DAS API...");
        }
      }
    }
  } catch (dexError) {
    console.log("[Solana API] DexScreener lookup failed:", dexError);
  }
  
  // Try Helius DAS API for logo (works well for pump tokens)
  if (dexScreenerResult && !dexScreenerResult.logoUri && process.env.SOLANA_RPC_URL?.includes("helius")) {
    try {
      console.log("[Solana API] Trying Helius DAS API for logo...");
      const dasResponse = await fetch(process.env.SOLANA_RPC_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getAsset",
          params: { id: mintAddress },
        }),
      });
      
      if (dasResponse.ok) {
        const dasData = await dasResponse.json();
        const imageUri = dasData.result?.content?.links?.image || 
                        dasData.result?.content?.files?.[0]?.uri ||
                        dasData.result?.content?.files?.[0]?.cdn_uri;
        const decimals = dasData.result?.token_info?.decimals ?? 9;
        
        if (imageUri) {
          console.log(`[Solana API] Got logo from Helius DAS: ${imageUri.slice(0, 50)}`);
          return {
            mint: mintAddress,
            name: dexScreenerResult.name,
            symbol: dexScreenerResult.symbol,
            decimals,
            logoUri: imageUri,
          };
        }
      }
    } catch (dasError) {
      console.log("[Solana API] Helius DAS API lookup failed:", dasError);
    }
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
        
        // Parse URI from Metaplex metadata (after symbol)
        const uriOffset = symbolOffset + 10 + 4;
        const uriLength = Math.min(data.readUInt32LE(uriOffset - 4), 200);
        const uriBytes = data.slice(uriOffset, uriOffset + uriLength);
        const uri = uriBytes.toString("utf8").replace(/\0/g, "").trim();
        
        let logoUri: string | undefined;
        
        // Try to fetch the off-chain metadata JSON for the logo
        if (uri && (uri.startsWith("http://") || uri.startsWith("https://") || uri.startsWith("ipfs://"))) {
          try {
            let fetchUrl = uri;
            if (uri.startsWith("ipfs://")) {
              fetchUrl = `https://ipfs.io/ipfs/${uri.slice(7)}`;
            }
            console.log(`[Solana API] Fetching off-chain metadata from ${fetchUrl.slice(0, 50)}...`);
            const offChainRes = await fetch(fetchUrl, { 
              headers: { "Accept": "application/json" },
              signal: AbortSignal.timeout(5000),
            });
            if (offChainRes.ok) {
              const offChainData = await offChainRes.json();
              logoUri = offChainData.image || offChainData.logo || offChainData.icon;
              if (logoUri?.startsWith("ipfs://")) {
                logoUri = `https://ipfs.io/ipfs/${logoUri.slice(7)}`;
              }
              console.log(`[Solana API] Got logo from off-chain metadata: ${logoUri?.slice(0, 50) || "none"}`);
            }
          } catch (offChainErr) {
            console.log("[Solana API] Failed to fetch off-chain metadata for logo");
          }
        }
        
        // If we have DexScreener data, use its name/symbol but add Metaplex logo
        if (dexScreenerResult && logoUri) {
          console.log(`[Solana API] Combining DexScreener data with Metaplex logo for ${dexScreenerResult.symbol}`);
          return {
            mint: mintAddress,
            name: dexScreenerResult.name,
            symbol: dexScreenerResult.symbol,
            decimals,
            logoUri,
          };
        }
        
        if (name && symbol) {
          console.log(`[Solana API] Found token via Metaplex: ${symbol}`);
          return {
            mint: mintAddress,
            name,
            symbol,
            decimals,
            logoUri,
          };
        }
      }
    } catch (metaplexError) {
      console.log("[Solana API] Metaplex metadata lookup failed");
    }
    
    // If we have DexScreener result (but no logo), return it
    if (dexScreenerResult) {
      console.log(`[Solana API] Returning DexScreener data without logo for ${dexScreenerResult.symbol}`);
      return {
        mint: mintAddress,
        name: dexScreenerResult.name,
        symbol: dexScreenerResult.symbol,
        decimals,
      };
    }
    
    // Try Helius DAS API as final fallback for name/symbol
    if (process.env.SOLANA_RPC_URL?.includes("helius")) {
      try {
        console.log("[Solana API] Trying Helius DAS API for token metadata...");
        const dasResponse = await fetch(process.env.SOLANA_RPC_URL!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAsset",
            params: { id: mintAddress },
          }),
        });
        
        if (dasResponse.ok) {
          const dasData = await dasResponse.json();
          const content = dasData.result?.content;
          const tokenInfo = dasData.result?.token_info;
          
          const dasName = content?.metadata?.name || dasData.result?.id?.slice(0, 8);
          const dasSymbol = content?.metadata?.symbol || tokenInfo?.symbol || mintAddress.slice(0, 4).toUpperCase();
          const dasLogo = content?.links?.image || content?.files?.[0]?.uri || content?.files?.[0]?.cdn_uri;
          const dasDecimals = tokenInfo?.decimals || decimals;
          
          if (dasName && dasSymbol) {
            console.log(`[Solana API] Found via Helius DAS: ${dasSymbol} (${dasName})`);
            return {
              mint: mintAddress,
              name: dasName,
              symbol: dasSymbol,
              decimals: dasDecimals,
              logoUri: dasLogo,
            };
          }
        }
      } catch (dasErr) {
        console.log("[Solana API] Helius DAS fallback failed:", dasErr);
      }
    }
    
    // Final fallback: return with minimal info (should rarely happen)
    console.log(`[Solana API] WARNING: Could not resolve metadata for ${mintAddress.slice(0, 8)}`);
    return {
      mint: mintAddress,
      name: `Token ${mintAddress.slice(0, 4)}...${mintAddress.slice(-4)}`,
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
  type: "send" | "receive" | "swap" | "unknown";
  amount?: string;
  tokenSymbol?: string;
  tokenMint?: string;
  from?: string;
  to?: string;
  swapInfo?: {
    fromAmount: string;
    fromSymbol: string;
    toAmount: string;
    toSymbol: string;
  };
}

const KNOWN_DEX_PROGRAMS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",  // Jupiter v6
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",  // Jupiter v4
  "JUP3c2Uh3WA4Ng34tw6kPd2G4C5BB21Xo36Je1s32Ph",  // Jupiter v3
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",  // Pump.fun bonding curve
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",  // PumpSwap AMM
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", // Raydium CPMM
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP", // Orca Whirlpool
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",  // Orca v2
  "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX",  // Serum DEX
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",  // Meteora LB
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB", // Meteora pools
]);

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
      
      let type: "send" | "receive" | "swap" | "unknown" = "unknown";
      let amount: string | undefined;
      let tokenSymbol: string | undefined;
      let tokenMint: string | undefined;
      let from: string | undefined;
      let to: string | undefined;
      let swapInfo: SolanaTransaction["swapInfo"] | undefined;
      
      const instructions = tx.transaction.message.instructions;
      
      // Check if this is a DEX/swap transaction
      const accountKeys = tx.transaction.message.accountKeys;
      const involvedPrograms = accountKeys
        .map((key: any) => typeof key === "string" ? key : key.pubkey?.toString())
        .filter((k: string | undefined): k is string => !!k);
      
      const isDexTransaction = involvedPrograms.some((prog: string) => KNOWN_DEX_PROGRAMS.has(prog));
      
      if (isDexTransaction) {
        // This is a swap - calculate net SOL change
        const preBalances = tx.meta.preBalances;
        const postBalances = tx.meta.postBalances;
        const userIndex = involvedPrograms.findIndex((k: string) => k === address);

        // Calculate SOL delta (only when user is found in account keys)
        let solDelta = 0;
        if (userIndex >= 0 && preBalances && postBalances) {
          solDelta = (postBalances[userIndex] - preBalances[userIndex]) / LAMPORTS_PER_SOL;
        }

        // Look for token balance changes (always, regardless of userIndex)
        const preTokenBalances = tx.meta.preTokenBalances || [];
        const postTokenBalances = tx.meta.postTokenBalances || [];

        // Find token balance changes for the user
        let tokenReceived: { amount: string; symbol: string; mint: string } | null = null;
        let tokenSent: { amount: string; symbol: string; mint: string } | null = null;

        for (const post of postTokenBalances) {
          if (post.owner === address) {
            const pre = preTokenBalances.find(
              (p: any) => p.owner === address && p.mint === post.mint
            );
            // Use uiAmountString as fallback since uiAmount can be null (deprecated field)
            const preAmount = pre?.uiTokenAmount?.uiAmount ?? parseFloat(pre?.uiTokenAmount?.uiAmountString || "0");
            const postAmount = post.uiTokenAmount?.uiAmount ?? parseFloat(post.uiTokenAmount?.uiAmountString || "0");
            const delta = postAmount - preAmount;

            if (delta > 0) {
              // Try to get token symbol
              let symbol = post.mint.slice(0, 4).toUpperCase();
              try {
                const metadata = await getSplTokenMetadata(post.mint);
                if (metadata?.symbol) symbol = metadata.symbol;
              } catch {}

              tokenReceived = {
                amount: Math.abs(delta).toString(),
                symbol,
                mint: post.mint,
              };
            } else if (delta < 0) {
              let symbol = post.mint.slice(0, 4).toUpperCase();
              try {
                const metadata = await getSplTokenMetadata(post.mint);
                if (metadata?.symbol) symbol = metadata.symbol;
              } catch {}

              tokenSent = {
                amount: Math.abs(delta).toString(),
                symbol,
                mint: post.mint,
              };
            }
          }
        }

        // Check pre balances for tokens completely removed (account closed after selling all)
        if (!tokenSent) {
          for (const pre of preTokenBalances) {
            if (pre.owner === address) {
              const postEntry = postTokenBalances.find(
                (p: any) => p.owner === address && p.mint === pre.mint
              );
              if (!postEntry) {
                const preAmount = pre.uiTokenAmount?.uiAmount ?? parseFloat(pre.uiTokenAmount?.uiAmountString || "0");
                if (preAmount > 0) {
                  let symbol = pre.mint.slice(0, 4).toUpperCase();
                  try {
                    const metadata = await getSplTokenMetadata(pre.mint);
                    if (metadata?.symbol) symbol = metadata.symbol;
                  } catch {}

                  tokenSent = {
                    amount: preAmount.toString(),
                    symbol,
                    mint: pre.mint,
                  };
                  break;
                }
              }
            }
          }
        }

        // Determine swap direction
        if (solDelta < -0.001 && tokenReceived) {
          // Sold SOL for tokens
          type = "swap";
          swapInfo = {
            fromAmount: Math.abs(solDelta).toFixed(6),
            fromSymbol: "SOL",
            toAmount: tokenReceived.amount,
            toSymbol: tokenReceived.symbol,
          };
          amount = Math.abs(solDelta).toFixed(6);
          tokenSymbol = "SOL";
          tokenMint = tokenReceived.mint;
        } else if (solDelta > 0.001 && tokenSent) {
          // Sold tokens for SOL
          type = "swap";
          swapInfo = {
            fromAmount: tokenSent.amount,
            fromSymbol: tokenSent.symbol,
            toAmount: solDelta.toFixed(6),
            toSymbol: "SOL",
          };
          amount = tokenSent.amount;
          tokenSymbol = tokenSent.symbol;
          tokenMint = undefined;
        } else if (tokenSent && tokenReceived) {
          // Token to token swap
          type = "swap";
          swapInfo = {
            fromAmount: tokenSent.amount,
            fromSymbol: tokenSent.symbol,
            toAmount: tokenReceived.amount,
            toSymbol: tokenReceived.symbol,
          };
          amount = tokenSent.amount;
          tokenSymbol = tokenSent.symbol;
        } else if (tokenReceived && solDelta < 0) {
          // Bought tokens - SOL decrease below threshold but token was received
          type = "swap";
          swapInfo = {
            fromAmount: Math.abs(solDelta).toFixed(6),
            fromSymbol: "SOL",
            toAmount: tokenReceived.amount,
            toSymbol: tokenReceived.symbol,
          };
          amount = Math.abs(solDelta).toFixed(6);
          tokenSymbol = "SOL";
          tokenMint = tokenReceived.mint;
        } else if (tokenSent && solDelta > 0) {
          // Sold tokens - SOL increase below threshold but token was sent
          type = "swap";
          swapInfo = {
            fromAmount: tokenSent.amount,
            fromSymbol: tokenSent.symbol,
            toAmount: solDelta.toFixed(6),
            toSymbol: "SOL",
          };
          amount = tokenSent.amount;
          tokenSymbol = tokenSent.symbol;
          tokenMint = undefined;
        } else if (tokenReceived) {
          // DEX interaction - received tokens (SOL change may be hidden in wrapped SOL)
          type = "swap";
          swapInfo = {
            fromAmount: Math.abs(solDelta).toFixed(6),
            fromSymbol: "SOL",
            toAmount: tokenReceived.amount,
            toSymbol: tokenReceived.symbol,
          };
          amount = tokenReceived.amount;
          tokenSymbol = tokenReceived.symbol;
          tokenMint = tokenReceived.mint;
        } else if (tokenSent) {
          // DEX interaction - sent tokens (SOL change may be hidden in wrapped SOL)
          type = "swap";
          swapInfo = {
            fromAmount: tokenSent.amount,
            fromSymbol: tokenSent.symbol,
            toAmount: Math.abs(solDelta).toFixed(6),
            toSymbol: "SOL",
          };
          amount = tokenSent.amount;
          tokenSymbol = tokenSent.symbol;
          tokenMint = undefined;
        }

        if (type === "swap") {
          transactions.push({
            signature: sig.signature,
            blockTime: sig.blockTime ?? null,
            slot: sig.slot,
            err: sig.err,
            type,
            amount,
            tokenSymbol,
            tokenMint,
            from: address,
            to: undefined,
            swapInfo,
          });
          continue;
        }
      }
      
      // Collect top-level instructions only
      const allInstructions: any[] = [...instructions];
      // IMPORTANT: do NOT include tx.meta.innerInstructions here.
      // Inner instructions from DEX swaps cause hop transfers to be mis-labeled as "Send".
      
      // Track SOL transfer separately - SPL token transfers take priority
      let solTransfer: { amount: string; from: string; to: string; type: "send" | "receive" } | null = null;
      let splTransferFound = false;
      
      // Helper function to process SPL transfer instruction
      const processSplTransfer = async (ix: any): Promise<boolean> => {
        if (!("parsed" in ix) || ix.program !== "spl-token") return false;
        if (ix.parsed?.type !== "transfer" && ix.parsed?.type !== "transferChecked") return false;
        
        const info = ix.parsed.info;
        
        // For SPL transfers, authority is the wallet owner, source/destination are TOKEN ACCOUNTS
        const authority = info.authority;
        const sourceTokenAccount = info.source;
        const destTokenAccount = info.destination;
        
        // For transferChecked, mint is in info.mint
        // For regular transfer, we need to look it up from the token account
        tokenMint = info.mint;
        let decimals = 9; // Default for most tokens
        
        // Resolve mint and owner from source token account (needed for regular 'transfer' instructions)
        let sourceOwner = authority;
        let destOwner = destTokenAccount; // Will try to resolve below
        
        if (sourceTokenAccount) {
          try {
            const tokenAcct = await connection.getParsedAccountInfo(new PublicKey(sourceTokenAccount));
            if (tokenAcct.value?.data && "parsed" in tokenAcct.value.data) {
              const parsedData = tokenAcct.value.data.parsed.info;
              if (!tokenMint) tokenMint = parsedData.mint;
              sourceOwner = parsedData.owner || authority;
            }
          } catch (e) {
            console.log(`[Solana History] Could not parse source token account:`, e);
          }
        }
        
        // Try to resolve destination owner from token account
        if (destTokenAccount) {
          try {
            const destAcct = await connection.getParsedAccountInfo(new PublicKey(destTokenAccount));
            if (destAcct.value?.data && "parsed" in destAcct.value.data) {
              const parsedData = destAcct.value.data.parsed.info;
              destOwner = parsedData.owner || destTokenAccount;
            }
          } catch (e) {
            // Keep the token account address as fallback
          }
        }
        
        // Get decimals from mint
        if (tokenMint) {
          try {
            const mintInfo = await connection.getParsedAccountInfo(new PublicKey(tokenMint));
            if (mintInfo.value?.data && "parsed" in mintInfo.value.data) {
              decimals = mintInfo.value.data.parsed.info.decimals || 9;
            }
          } catch (e) {
            console.log(`[Solana History] Could not get mint decimals, using default 9:`, e);
          }
        }
        
        if (info.tokenAmount) {
          // transferChecked has tokenAmount with UI values
          amount = info.tokenAmount.uiAmountString || info.tokenAmount.uiAmount?.toString();
        } else if (info.amount) {
          // Regular transfer only has raw amount - ALWAYS convert using decimals
          try {
            const rawAmount = BigInt(info.amount);
            const divisor = BigInt(10 ** decimals);
            const uiAmount = Number(rawAmount) / Number(divisor);
            amount = uiAmount.toString();
            console.log(`[Solana History] Converted SPL amount: ${info.amount} -> ${amount} (${decimals} decimals)`);
          } catch (e) {
            console.error(`[Solana History] Failed to convert amount:`, e);
            // Convert assuming 9 decimals as safe fallback
            const rawNum = Number(info.amount) || 0;
            amount = (rawNum / 1e9).toString();
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
        
        // Only accept if user is actually involved in this transfer
        const userInvolved =
          sourceOwner === address ||
          destOwner === address ||
          authority === address;
        if (!userInvolved) return false;
        
        // Determine send/receive based on wallet address matching the authority/owner
        if (sourceOwner === address || authority === address) {
          type = "send";
        } else if (destOwner === address) {
          type = "receive";
        } else {
          return false;
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
            
            // Skip if user is not source or destination
            if (info.source !== address && info.destination !== address) continue;
            
            const solAmount = (lamports / LAMPORTS_PER_SOL).toString();
            let solType: "send" | "receive";
            
            if (info.source === address) {
              solType = "send";
            } else {
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
