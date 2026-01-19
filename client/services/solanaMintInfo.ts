import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { MintCoreInfo, MetadataInfo } from "@/types/tokenSafety";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export type TokenProgramType = "spl" | "token2022" | "unknown";

export async function detectTokenProgram(
  connection: Connection,
  mint: PublicKey
): Promise<TokenProgramType> {
  try {
    const accountInfo = await connection.getAccountInfo(mint);
    if (!accountInfo) return "unknown";

    const owner = accountInfo.owner.toBase58();
    if (owner === TOKEN_PROGRAM_ID.toBase58()) return "spl";
    if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) return "token2022";
    return "unknown";
  } catch (err) {
    if (__DEV__) console.log("[solanaMintInfo] detectTokenProgram error:", err);
    return "unknown";
  }
}

export async function fetchMintCore(
  connection: Connection,
  mint: PublicKey,
  program: TokenProgramType
): Promise<MintCoreInfo | null> {
  try {
    const programId =
      program === "token2022" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

    const mintInfo = await getMint(connection, mint, undefined, programId);

    return {
      decimals: mintInfo.decimals,
      supply: mintInfo.supply,
      mintAuthority: mintInfo.mintAuthority?.toBase58() ?? null,
      freezeAuthority: mintInfo.freezeAuthority?.toBase58() ?? null,
    };
  } catch (err) {
    if (__DEV__) console.log("[solanaMintInfo] fetchMintCore error:", err);
    return null;
  }
}

function findMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

export async function fetchMetadataInfo(
  connection: Connection,
  mint: PublicKey
): Promise<MetadataInfo | null> {
  try {
    const metadataPda = findMetadataPda(mint);
    const accountInfo = await connection.getAccountInfo(metadataPda);

    if (!accountInfo || accountInfo.data.length < 67) {
      return null;
    }

    const data = accountInfo.data;
    const updateAuthority = new PublicKey(data.slice(1, 33)).toBase58();
    const isMutable = data[66] === 1;

    let name = "";
    let symbol = "";
    let uri = "";

    try {
      const nameLen = data.readUInt32LE(67);
      if (nameLen > 0 && nameLen < 100) {
        name = data.slice(71, 71 + nameLen).toString("utf8").replace(/\0/g, "").trim();
      }

      const symbolOffset = 71 + 32;
      if (data.length > symbolOffset + 4) {
        const symbolLen = data.readUInt32LE(symbolOffset);
        if (symbolLen > 0 && symbolLen < 20) {
          symbol = data
            .slice(symbolOffset + 4, symbolOffset + 4 + symbolLen)
            .toString("utf8")
            .replace(/\0/g, "")
            .trim();
        }
      }

      const uriOffset = symbolOffset + 4 + 10;
      if (data.length > uriOffset + 4) {
        const uriLen = data.readUInt32LE(uriOffset);
        if (uriLen > 0 && uriLen < 300) {
          uri = data
            .slice(uriOffset + 4, uriOffset + 4 + uriLen)
            .toString("utf8")
            .replace(/\0/g, "")
            .trim();
        }
      }
    } catch {
    }

    return {
      updateAuthority,
      isMutable,
      name: name || undefined,
      symbol: symbol || undefined,
      uri: uri || undefined,
    };
  } catch (err) {
    if (__DEV__) console.log("[solanaMintInfo] fetchMetadataInfo error:", err);
    return null;
  }
}

export async function fetchAuthorityRecentActivity(
  connection: Connection,
  authority: string
): Promise<{ isActive: boolean; signatureCount: number }> {
  try {
    const pubkey = new PublicKey(authority);
    const sigs = await connection.getSignaturesForAddress(pubkey, { limit: 10 });
    const recentCount = sigs.filter((s) => {
      if (!s.blockTime) return false;
      const ageHours = (Date.now() / 1000 - s.blockTime) / 3600;
      return ageHours < 24;
    }).length;

    return {
      isActive: recentCount > 0,
      signatureCount: sigs.length,
    };
  } catch (err) {
    if (__DEV__) console.log("[solanaMintInfo] fetchAuthorityRecentActivity error:", err);
    return { isActive: false, signatureCount: 0 };
  }
}

export async function fetchTopHolders(
  connection: Connection,
  mint: PublicKey,
  supply: bigint,
  decimals: number
): Promise<{
  topPct: number;
  topCount: number;
  largestAccounts: Array<{ address: string; amount: string; uiAmount: number }>;
} | null> {
  try {
    const largest = await connection.getTokenLargestAccounts(mint);
    if (!largest.value || largest.value.length === 0) {
      return null;
    }

    const top10 = largest.value.slice(0, 10);
    let sumAmount = BigInt(0);
    const accounts: Array<{ address: string; amount: string; uiAmount: number }> = [];

    for (const acc of top10) {
      const amount = BigInt(acc.amount);
      sumAmount += amount;
      accounts.push({
        address: acc.address.toBase58(),
        amount: acc.amount,
        uiAmount: acc.uiAmount ?? Number(amount) / Math.pow(10, decimals),
      });
    }

    const supplyNum = Number(supply);
    const sumNum = Number(sumAmount);
    const topPct = supplyNum > 0 ? (sumNum / supplyNum) * 100 : 0;

    return {
      topPct,
      topCount: top10.length,
      largestAccounts: accounts,
    };
  } catch (err) {
    if (__DEV__) console.log("[solanaMintInfo] fetchTopHolders error:", err);
    return null;
  }
}
