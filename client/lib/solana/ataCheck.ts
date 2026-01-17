import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const NATIVE_SOL_MINT = NATIVE_MINT.toBase58();

const ataExistsCache = new Map<string, boolean>();

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

    const ataStandard = getAssociatedTokenAddressSync(mintPubkey, ownerPubkey, false, TOKEN_PROGRAM_ID);

    const accountInfo = await connection.getAccountInfo(ataStandard);

    if (accountInfo !== null) {
      ataExistsCache.set(cacheKey, true);
      return false;
    }

    const ata2022 = getAssociatedTokenAddressSync(mintPubkey, ownerPubkey, false, TOKEN_2022_PROGRAM_ID);
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
