import { mnemonicToAccount } from "viem/accounts";
import bs58 from "bs58";
import { deriveSolanaKeypair } from "@/lib/solana/keys";

export function deriveEvmPrivateKey(mnemonic: string): string {
  const account = mnemonicToAccount(mnemonic);
  return account.getHdKey().privateKey 
    ? `0x${Buffer.from(account.getHdKey().privateKey!).toString("hex")}`
    : "";
}

export function deriveSolanaPrivateKey(mnemonic: string): string {
  const { secretKey } = deriveSolanaKeypair(mnemonic);
  return bs58.encode(secretKey);
}
