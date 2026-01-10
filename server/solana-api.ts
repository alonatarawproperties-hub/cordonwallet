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
  try {
    const mintPubkey = new PublicKey(mintAddress);
    
    const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
    if (!mintInfo.value?.data || !("parsed" in mintInfo.value.data)) {
      return null;
    }
    
    const parsedData = mintInfo.value.data.parsed;
    const decimals = parsedData.info.decimals;
    
    const jupiterResponse = await fetch(
      `https://tokens.jup.ag/token/${mintAddress}`
    );
    
    if (jupiterResponse.ok) {
      const jupiterData = await jupiterResponse.json();
      return {
        mint: mintAddress,
        name: jupiterData.name || "Unknown Token",
        symbol: jupiterData.symbol || "???",
        decimals,
        logoUri: jupiterData.logoURI,
      };
    }
    
    const solscanResponse = await fetch(
      `https://pro-api.solscan.io/v2.0/token/meta?address=${mintAddress}`,
      { headers: { "Accept": "application/json" } }
    );
    
    if (solscanResponse.ok) {
      const solscanData = await solscanResponse.json();
      if (solscanData.success && solscanData.data) {
        return {
          mint: mintAddress,
          name: solscanData.data.name || "Unknown Token",
          symbol: solscanData.data.symbol || "???",
          decimals,
          logoUri: solscanData.data.icon,
        };
      }
    }
    
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
