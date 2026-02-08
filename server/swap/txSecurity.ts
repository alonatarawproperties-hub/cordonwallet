import {
  Connection,
  VersionedTransaction,
  AddressLookupTableAccount,
  PublicKey,
} from "@solana/web3.js";
import {
  ALLOWED_PROGRAM_IDS,
  JUPITER_PROGRAM_IDS,
  PUMP_PROGRAM_IDS,
} from "./solanaPrograms";

export type SwapRouteType = "jupiter" | "pump" | "none";

export interface SwapSecurityResult {
  safe: boolean;
  warnings: string[];
  errors: string[];
  details: {
    feePayer: string;
    feePayerIsUser: boolean;
    userIsSigner: boolean;
    programIds: string[];
    unknownPrograms: string[];
    hasJupiterProgram: boolean;
    hasPumpProgram: boolean;
    hasLuts: boolean;
    addressLookupTables: string[];
  };
}

export async function validateSwapTxServer(args: {
  txBase64: string;
  expectedUserPubkey: string;
  routeType?: SwapRouteType;
  connection: Connection;
}): Promise<SwapSecurityResult> {
  const { txBase64, expectedUserPubkey, routeType, connection } = args;

  const warnings: string[] = [];
  const errors: string[] = [];
  const programIds: string[] = [];
  const unknownPrograms: string[] = [];
  const addressLookupTables: string[] = [];

  let feePayer = "";
  let feePayerIsUser = false;
  let userIsSigner = false;
  let hasJupiterProgram = false;
  let hasPumpProgram = false;
  let hasLuts = false;

  try {
    const txBuffer = Buffer.from(txBase64, "base64");
    const tx = VersionedTransaction.deserialize(txBuffer);
    const message = tx.message;
    const staticKeys = message.staticAccountKeys;

    if (staticKeys.length > 0) {
      feePayer = staticKeys[0].toBase58();
      // Base58 is case-sensitive — compare exact strings (canonical form)
      feePayerIsUser = feePayer === expectedUserPubkey;
    }

    if (!feePayerIsUser) {
      errors.push(
        `Fee payer mismatch: expected ${expectedUserPubkey.slice(0, 8)}..., got ${feePayer.slice(0, 8)}...`
      );
    }

    const header = message.header;
    const numSigners = header.numRequiredSignatures;
    const signerKeys = staticKeys.slice(0, numSigners).map((k) => k.toBase58());
    userIsSigner = signerKeys.includes(expectedUserPubkey);

    if (!userIsSigner) {
      errors.push(`User is not a required signer on this transaction.`);
    }

    const lutMetas = (message as any).addressTableLookups || [];
    hasLuts = lutMetas.length > 0;

    let allAccountKeys: PublicKey[] = [...staticKeys];

    if (hasLuts) {
      const lutAddresses: PublicKey[] = lutMetas.map(
        (meta: { accountKey: PublicKey }) => meta.accountKey
      );
      addressLookupTables.push(...lutAddresses.map((k) => k.toBase58()));

      const lutResults = await Promise.all(
        lutAddresses.map((addr) =>
          connection.getAddressLookupTable(addr).catch(() => null)
        )
      );

      for (let i = 0; i < lutMetas.length; i++) {
        const lutResult = lutResults[i];
        const meta = lutMetas[i];

        if (!lutResult || !lutResult.value) {
          warnings.push(
            `Could not resolve LUT: ${lutAddresses[i].toBase58().slice(0, 8)}...`
          );
          continue;
        }

        const lutAccount: AddressLookupTableAccount = lutResult.value;

        for (const idx of meta.writableIndexes) {
          if (idx < lutAccount.state.addresses.length) {
            allAccountKeys.push(lutAccount.state.addresses[idx]);
          }
        }
        for (const idx of meta.readonlyIndexes) {
          if (idx < lutAccount.state.addresses.length) {
            allAccountKeys.push(lutAccount.state.addresses[idx]);
          }
        }
      }
    }

    const compiledInstructions = message.compiledInstructions;

    for (const ix of compiledInstructions) {
      const programIdx = ix.programIdIndex;
      if (programIdx >= allAccountKeys.length) {
        warnings.push(`Instruction references out-of-bounds program index: ${programIdx}`);
        continue;
      }

      const programId = allAccountKeys[programIdx].toBase58();

      if (!programIds.includes(programId)) {
        programIds.push(programId);
      }

      if (JUPITER_PROGRAM_IDS.has(programId)) {
        hasJupiterProgram = true;
      }

      if (PUMP_PROGRAM_IDS.has(programId)) {
        hasPumpProgram = true;
      }

      if (!ALLOWED_PROGRAM_IDS.has(programId)) {
        if (!unknownPrograms.includes(programId)) {
          unknownPrograms.push(programId);
        }
      }
    }

    if (unknownPrograms.length > 0) {
      errors.push(
        `Blocked for safety: unexpected program detected: ${unknownPrograms.map((p) => p.slice(0, 8) + "...").join(", ")}`
      );
    }

    if (!hasJupiterProgram && !hasPumpProgram) {
      if (routeType === "pump") {
        warnings.push("No Pump.fun program detected in transaction.");
      } else if (routeType === "jupiter") {
        warnings.push("No Jupiter program detected in transaction.");
      } else {
        warnings.push("No known swap program detected in transaction.");
      }
    }
  } catch (error: any) {
    errors.push(`Failed to decode/validate transaction: ${error.message}`);
  }

  return {
    safe: errors.length === 0,
    warnings,
    errors,
    details: {
      feePayer,
      feePayerIsUser,
      userIsSigner,
      programIds,
      unknownPrograms,
      hasJupiterProgram,
      hasPumpProgram,
      hasLuts,
      addressLookupTables,
    },
  };
}
