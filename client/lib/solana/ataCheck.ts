import { Connection, PublicKey } from "@solana/web3.js";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111111";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const ataExistsCache = new Map<string, boolean>();

function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
  programId: PublicKey = TOKEN_PROGRAM_ID
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return address;
}

export interface AtaCheckParams {
  owner: string;
  mint: string;
  hasTokenInWalletList: boolean;
  connection: Connection;
}

export async function likelyNeedsAtaRent(params: AtaCheckParams): Promise<boolean> {
  const { owner, mint, hasTokenInWalletList, connection } = params;

  if (!mint || mint === NATIVE_SOL_MINT || mint === WRAPPED_SOL_MINT) {
    return false;
  }

  if (hasTokenInWalletList) {
    return false;
  }

  const cacheKey = `${owner}:${mint}`;
  if (ataExistsCache.has(cacheKey)) {
    return !ataExistsCache.get(cacheKey)!;
  }

  try {
    const ownerPubkey = new PublicKey(owner);
    const mintPubkey = new PublicKey(mint);

    const ataStandard = getAssociatedTokenAddress(mintPubkey, ownerPubkey, TOKEN_PROGRAM_ID);

    const accountInfo = await connection.getAccountInfo(ataStandard);

    if (accountInfo !== null) {
      ataExistsCache.set(cacheKey, true);
      return false;
    }

    const ata2022 = getAssociatedTokenAddress(mintPubkey, ownerPubkey, TOKEN_2022_PROGRAM_ID);
    const accountInfo2022 = await connection.getAccountInfo(ata2022);

    if (accountInfo2022 !== null) {
      ataExistsCache.set(cacheKey, true);
      return false;
    }

    ataExistsCache.set(cacheKey, false);
    return true;
  } catch (error) {
    if (__DEV__) {
      console.log("[ataCheck] RPC error, assuming ATA needed for", mint, error);
    }
    return true;
  }
}

export function clearAtaCache(): void {
  ataExistsCache.clear();
}

export function hasAtaCached(owner: string, mint: string): boolean | undefined {
  const cacheKey = `${owner}:${mint}`;
  return ataExistsCache.has(cacheKey) ? ataExistsCache.get(cacheKey) : undefined;
}
