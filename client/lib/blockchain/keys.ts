import { mnemonicToAccount } from "viem/accounts";
import bs58 from "bs58";
import { deriveSolanaKeypair } from "@/lib/solana/keys";
import { bytesToHex } from "viem";

export function deriveEvmPrivateKey(mnemonic: string): string {
  const account = mnemonicToAccount(mnemonic);
  const hdKey = account.getHdKey();
  if (hdKey.privateKey) {
    return bytesToHex(hdKey.privateKey);
  }
  return "";
}

export function deriveSolanaPrivateKey(mnemonic: string): string {
  const { secretKey } = deriveSolanaKeypair(mnemonic);
  const encoded = bs58.encode(secretKey);
  secretKey.fill(0);
  return encoded;
}
