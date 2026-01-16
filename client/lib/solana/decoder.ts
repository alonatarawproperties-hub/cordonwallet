import { Transaction, VersionedTransaction, PublicKey } from "@solana/web3.js";

export interface DrainerDetection {
  isBlocked: boolean;
  attackType: "SetAuthority" | "Assign" | null;
  description: string;
}

export interface DecodedSolanaTransaction {
  instructionCount: number;
  programIds: string[];
  programLabels: string[];
  isSimpleTransfer: boolean;
  usesSystemProgram: boolean;
  usesTokenProgram: boolean;
  usesATAProgram: boolean;
  hasUnknownPrograms: boolean;
  unknownProgramIds: string[];
  hasLookupTables: boolean;
  unresolvedLookupPrograms: number;
  riskLevel: "Low" | "Medium" | "High" | "Blocked";
  riskReason: string;
  drainerDetection: DrainerDetection;
}

export interface DecodeContext {
  userPubkey: string;
  intent?: "swap" | "dapp" | "unknown";
}

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const SYSTEM_INSTRUCTION_ASSIGN = 1;
const TOKEN_INSTRUCTION_SET_AUTHORITY = 6;

const SAFE_OWNERS = new Set([
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ATA_PROGRAM_ID,
  "ComputeBudget111111111111111111111111111111",
]);

const JUPITER_PROGRAMS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",
  "JUP3c2Uh3WA4Ng34tw6kPd2G4C5BB21Xo36Je1s32Ph",
  "JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo",
]);

const SWAP_SAFE_PROGRAMS = new Set([
  ...JUPITER_PROGRAMS,
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
]);

const KNOWN_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111": "System Program",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "SPL Token",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": "Associated Token",
  "ComputeBudget111111111111111111111111111111": "Compute Budget",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr": "Memo",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo": "Memo (v1)",
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s": "Metaplex",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter v6",
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB": "Jupiter v4",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc": "Orca Whirlpool",
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP": "Orca",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK": "Raydium CPMM",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM",
  "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX": "Serum DEX",
  "SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ": "Saber",
  "DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1": "Orca v2",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "Pump.fun",
  "TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN": "Tensor Swap",
  "M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K": "Magic Eden",
};

interface InstructionData {
  programId: string;
  data: Uint8Array;
  accounts: string[];
}

interface DrainerContext {
  userPubkey: string;
  feePayer: string;
  signerSet: Set<string>;
  intent: "swap" | "dapp" | "unknown";
  txProgramIds: string[];
}

function isSwapSafeTransaction(programIds: string[]): boolean {
  return programIds.some(id => SWAP_SAFE_PROGRAMS.has(id));
}

function detectDrainerInstructions(
  instructions: InstructionData[],
  ctx: DrainerContext
): DrainerDetection {
  try {
    const isSwapContext = ctx.intent === "swap" || isSwapSafeTransaction(ctx.txProgramIds);
    
    for (const ix of instructions) {
      if (ix.programId === SYSTEM_PROGRAM_ID && ix.data.length >= 4) {
        const instructionType =
          ix.data[0] | (ix.data[1] << 8) | (ix.data[2] << 16) | (ix.data[3] << 24);

        if (instructionType === SYSTEM_INSTRUCTION_ASSIGN) {
          const targetAccount = ix.accounts[0];
          if (!targetAccount) continue;

          let newOwnerPubkey: string | null = null;
          if (ix.data.length >= 36) {
            try {
              newOwnerPubkey = new PublicKey(ix.data.slice(4, 36)).toBase58();
            } catch {
              newOwnerPubkey = null;
            }
          }

          const isUserMainAccount = targetAccount === ctx.userPubkey;
          const isSafeOwner = newOwnerPubkey && SAFE_OWNERS.has(newOwnerPubkey);

          if (isUserMainAccount && !isSafeOwner) {
            return {
              isBlocked: true,
              attackType: "Assign",
              description:
                "BLOCKED: This transaction attempts to change your wallet's owner. This is a known wallet drainer attack that would give an attacker permanent control of your funds.",
            };
          }
        }
      }

      if (ix.programId === TOKEN_PROGRAM_ID && ix.data.length >= 1) {
        const instructionType = ix.data[0];

        if (instructionType === TOKEN_INSTRUCTION_SET_AUTHORITY) {
          const currentAuthority = ix.accounts[1];
          if (!currentAuthority) continue;

          if (currentAuthority !== ctx.userPubkey) {
            continue;
          }

          let authorityType: number | null = null;
          let hasNewAuthority = false;
          let newAuthority: string | null = null;

          if (ix.data.length >= 2) {
            authorityType = ix.data[1];
          }

          if (ix.data.length >= 3) {
            hasNewAuthority = ix.data[2] === 1;
          }

          if (hasNewAuthority && ix.data.length >= 35) {
            try {
              newAuthority = new PublicKey(ix.data.slice(3, 35)).toBase58();
            } catch {
              newAuthority = null;
            }
          }

          if (!hasNewAuthority || newAuthority === null) {
            continue;
          }

          if (newAuthority === ctx.userPubkey) {
            continue;
          }

          if (isSwapContext) {
            const isJupiterRelated = ctx.txProgramIds.some(id => JUPITER_PROGRAMS.has(id));
            const closeAuthorityType = 3;
            if (isJupiterRelated && authorityType === closeAuthorityType) {
              continue;
            }
          }

          if (isSwapContext) {
            return {
              isBlocked: false,
              attackType: "SetAuthority",
              description:
                "Warning: This swap transaction modifies token account authority. Review the transaction carefully before signing.",
            };
          }

          return {
            isBlocked: true,
            attackType: "SetAuthority",
            description:
              "BLOCKED: This transaction attempts to change ownership of your token account. This is a known wallet drainer attack that would give an attacker control of your tokens.",
          };
        }
      }
    }

    return {
      isBlocked: false,
      attackType: null,
      description: "",
    };
  } catch (err) {
    console.warn("[Decoder] detectDrainerInstructions error, allowing tx:", err);
    return {
      isBlocked: false,
      attackType: null,
      description: "Detection error - proceeding with caution",
    };
  }
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  let bufferLength = Math.floor(base64.length * 0.75);
  if (base64[base64.length - 1] === "=") bufferLength--;
  if (base64[base64.length - 2] === "=") bufferLength--;

  const bytes = new Uint8Array(bufferLength);
  let p = 0;

  for (let i = 0; i < base64.length; i += 4) {
    const encoded1 = lookup[base64.charCodeAt(i)];
    const encoded2 = lookup[base64.charCodeAt(i + 1)];
    const encoded3 = lookup[base64.charCodeAt(i + 2)];
    const encoded4 = lookup[base64.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (p < bufferLength) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    if (p < bufferLength) bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }

  return bytes;
}

export function decodeSolanaTransaction(
  txBase64: string,
  ctx?: DecodeContext
): DecodedSolanaTransaction {
  try {
    const txBytes = base64ToBytes(txBase64);
    const programIds: string[] = [];
    const instructionsData: InstructionData[] = [];
    let instructionCount = 0;
    let hasLookupTables = false;
    let unresolvedLookupPrograms = 0;
    let feePayerBase58 = "";
    const signerSet = new Set<string>();

    try {
      const versionedTx = VersionedTransaction.deserialize(txBytes);
      const staticKeys = versionedTx.message.staticAccountKeys;

      if (staticKeys.length > 0) {
        feePayerBase58 = staticKeys[0].toBase58();
      }

      for (let i = 0; i < staticKeys.length; i++) {
        if (versionedTx.message.isAccountSigner(i)) {
          signerSet.add(staticKeys[i].toBase58());
        }
      }

      instructionCount = versionedTx.message.compiledInstructions.length;

      const lookups = (versionedTx.message as any).addressTableLookups;
      hasLookupTables = lookups && lookups.length > 0;

      const allKeys: PublicKey[] = [...staticKeys];

      for (const ix of versionedTx.message.compiledInstructions) {
        let programId: string;
        if (ix.programIdIndex < allKeys.length) {
          programId = allKeys[ix.programIdIndex].toBase58();
        } else {
          unresolvedLookupPrograms++;
          continue;
        }

        if (!programIds.includes(programId)) {
          programIds.push(programId);
        }

        const accounts: string[] = [];
        for (const accIdx of ix.accountKeyIndexes) {
          if (accIdx < allKeys.length) {
            accounts.push(allKeys[accIdx].toBase58());
          }
        }

        instructionsData.push({
          programId,
          data: ix.data,
          accounts,
        });
      }

      if (programIds.length === 0 && hasLookupTables) {
        for (const key of staticKeys) {
          const addr = key.toBase58();
          if (KNOWN_PROGRAMS[addr] && !programIds.includes(addr)) {
            programIds.push(addr);
          }
        }
      }
    } catch {
      try {
        const legacyTx = Transaction.from(txBytes);
        instructionCount = legacyTx.instructions.length;

        if (legacyTx.feePayer) {
          feePayerBase58 = legacyTx.feePayer.toBase58();
        }

        for (const ix of legacyTx.instructions) {
          const programId = ix.programId.toBase58();
          if (!programIds.includes(programId)) {
            programIds.push(programId);
          }

          const accounts = ix.keys.map((k) => k.pubkey.toBase58());
          for (const k of ix.keys) {
            if (k.isSigner) {
              signerSet.add(k.pubkey.toBase58());
            }
          }

          instructionsData.push({
            programId,
            data: ix.data,
            accounts,
          });
        }
      } catch {
        return createFallbackResult(
          "Transaction format not recognized. Review with caution.",
          "High"
        );
      }
    }

    const userPubkey = ctx?.userPubkey || feePayerBase58;
    const drainerCtx: DrainerContext = {
      userPubkey,
      feePayer: feePayerBase58,
      signerSet,
      intent: ctx?.intent || "unknown",
      txProgramIds: programIds,
    };

    const drainerDetection = detectDrainerInstructions(instructionsData, drainerCtx);
    if (drainerDetection.isBlocked) {
      return createBlockedResult(drainerDetection);
    }

    if (programIds.length === 0) {
      if (hasLookupTables) {
        return {
          ...createFallbackResult(
            `Complex v0 transaction with ${instructionCount} instructions using address lookups. Cannot verify if this transaction contains dangerous instructions like SetAuthority. DO NOT sign transactions from untrusted sources.`,
            "High"
          ),
          drainerDetection: {
            isBlocked: false,
            attackType: null,
            description:
              "Transaction uses lookup tables that cannot be fully verified. Exercise extreme caution - drainer attacks may be hidden in unresolved instructions.",
          },
        };
      }
      return createFallbackResult("No programs identified. Review carefully.", "High");
    }

    return analyzeTransaction(
      programIds,
      instructionCount,
      hasLookupTables,
      unresolvedLookupPrograms
    );
  } catch (err) {
    console.warn("[Decoder] decodeSolanaTransaction error:", err);
    return createFallbackResult(
      "Transaction could not be decoded. Review with caution.",
      "High"
    );
  }
}

export function decodeSolanaTransactions(
  txBase64Array: string[],
  ctx?: DecodeContext
): DecodedSolanaTransaction {
  const allProgramIds: string[] = [];
  let totalInstructions = 0;
  let decodeFailures = 0;
  let hasAnyHighRisk = false;
  let hasAnyLookupTables = false;
  let totalUnresolvedLookups = 0;

  for (const txBase64 of txBase64Array) {
    const decoded = decodeSolanaTransaction(txBase64, ctx);

    if (decoded.riskLevel === "Blocked") {
      return decoded;
    }

    if (decoded.hasLookupTables) {
      hasAnyLookupTables = true;
    }
    totalUnresolvedLookups += decoded.unresolvedLookupPrograms;

    if (decoded.riskLevel === "High") {
      hasAnyHighRisk = true;
    }

    if (
      decoded.programLabels[0] === "Unable to decode" ||
      decoded.programIds.length === 0
    ) {
      decodeFailures++;
    } else {
      totalInstructions += decoded.instructionCount;
      for (const id of decoded.programIds) {
        if (!allProgramIds.includes(id)) {
          allProgramIds.push(id);
        }
      }
    }
  }

  if (allProgramIds.length === 0) {
    return createFallbackResult(
      `Could not decode any of ${txBase64Array.length} transactions. Review source carefully before signing.`,
      "High"
    );
  }

  const result = analyzeTransaction(
    allProgramIds,
    totalInstructions,
    hasAnyLookupTables,
    totalUnresolvedLookups
  );

  if (hasAnyHighRisk) {
    result.riskLevel = "High";
    if (decodeFailures > 0) {
      result.riskReason = `${decodeFailures} of ${txBase64Array.length} transactions could not be verified. Review source carefully.`;
    } else if (totalUnresolvedLookups > 0) {
      result.riskReason = `Batch contains ${totalUnresolvedLookups} unverifiable program call(s) via address lookups. Review source carefully.`;
    }
  } else if (decodeFailures > 0) {
    result.riskLevel = result.riskLevel === "Low" ? "Medium" : result.riskLevel;
    result.riskReason = `${result.riskReason} (${decodeFailures} of ${txBase64Array.length} transactions could not be fully decoded)`;
  }

  return result;
}

function createBlockedResult(
  drainerDetection: DrainerDetection
): DecodedSolanaTransaction {
  return {
    instructionCount: 1,
    programIds: [],
    programLabels: ["WALLET DRAINER DETECTED"],
    isSimpleTransfer: false,
    usesSystemProgram: false,
    usesTokenProgram: false,
    usesATAProgram: false,
    hasUnknownPrograms: true,
    unknownProgramIds: [],
    hasLookupTables: false,
    unresolvedLookupPrograms: 0,
    riskLevel: "Blocked",
    riskReason: drainerDetection.description,
    drainerDetection,
  };
}

function createFallbackResult(
  reason: string,
  riskLevel: "Low" | "Medium" | "High" = "Medium"
): DecodedSolanaTransaction {
  return {
    instructionCount: 1,
    programIds: [],
    programLabels: ["Unable to decode"],
    isSimpleTransfer: false,
    usesSystemProgram: false,
    usesTokenProgram: false,
    usesATAProgram: false,
    hasUnknownPrograms: true,
    unknownProgramIds: [],
    hasLookupTables: false,
    unresolvedLookupPrograms: 0,
    riskLevel,
    riskReason: reason,
    drainerDetection: { isBlocked: false, attackType: null, description: "" },
  };
}

function analyzeTransaction(
  programIds: string[],
  instructionCount: number,
  hasLookupTables = false,
  unresolvedLookupPrograms = 0
): DecodedSolanaTransaction {
  const programLabels = programIds.map(
    (id) => KNOWN_PROGRAMS[id] || shortenAddress(id)
  );
  const unknownProgramIds = programIds.filter((id) => !KNOWN_PROGRAMS[id]);

  const usesSystemProgram = programIds.includes(SYSTEM_PROGRAM_ID);
  const usesTokenProgram = programIds.includes(TOKEN_PROGRAM_ID);
  const usesATAProgram = programIds.includes(ATA_PROGRAM_ID);
  const hasUnknownPrograms =
    unknownProgramIds.length > 0 || unresolvedLookupPrograms > 0;

  const hasDex = programIds.some(
    (id) =>
      KNOWN_PROGRAMS[id]?.includes("Jupiter") ||
      KNOWN_PROGRAMS[id]?.includes("Raydium") ||
      KNOWN_PROGRAMS[id]?.includes("Orca") ||
      KNOWN_PROGRAMS[id]?.includes("Swap")
  );

  const isSimpleTransfer =
    instructionCount <= 2 &&
    (usesSystemProgram || usesTokenProgram) &&
    !hasUnknownPrograms &&
    !hasLookupTables;

  let riskLevel: "Low" | "Medium" | "High";
  let riskReason: string;

  if (isSimpleTransfer) {
    riskLevel = "Low";
    if (usesTokenProgram) {
      riskReason = "Simple SPL token transfer using official Token Program.";
    } else {
      riskReason =
        "Simple SOL transfer using System Program. No approvals or contract calls.";
    }
  } else if (hasLookupTables && unresolvedLookupPrograms > 0) {
    riskLevel = "High";
    if (hasDex) {
      const dexName =
        programLabels.find(
          (l) =>
            l.includes("Jupiter") || l.includes("Raydium") || l.includes("Orca")
        ) || "DEX";
      riskReason = `${dexName} swap with ${unresolvedLookupPrograms} unverifiable program(s) via address lookups. Cannot fully validate - review source carefully.`;
    } else {
      riskReason = `V0 transaction with ${unresolvedLookupPrograms} unverifiable program(s). Cannot fully validate - review source carefully.`;
    }
  } else if (hasUnknownPrograms) {
    if (hasDex && unknownProgramIds.length <= 1) {
      riskLevel = "Medium";
      riskReason =
        "DEX swap with additional program calls. Verify the transaction source.";
    } else {
      riskLevel = "High";
      riskReason = `Transaction calls ${unknownProgramIds.length} unknown program(s). Review carefully.`;
    }
  } else {
    if (hasDex) {
      riskLevel = "Low";
      riskReason = "DEX swap using known protocol. Standard trading operation.";
    } else if (instructionCount > 5) {
      riskLevel = "Medium";
      riskReason = `Complex transaction with ${instructionCount} instructions. Review details.`;
    } else {
      riskLevel = "Low";
      riskReason = "Transaction uses known Solana programs.";
    }
  }

  return {
    instructionCount,
    programIds,
    programLabels,
    isSimpleTransfer,
    usesSystemProgram,
    usesTokenProgram,
    usesATAProgram,
    hasUnknownPrograms,
    unknownProgramIds,
    hasLookupTables,
    unresolvedLookupPrograms,
    riskLevel,
    riskReason,
    drainerDetection: { isBlocked: false, attackType: null, description: "" },
  };
}

function shortenAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function getSolanaExplorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}
