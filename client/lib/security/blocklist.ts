const KNOWN_SCAM_ADDRESSES: Set<string> = new Set([
]);

const KNOWN_SCAM_PREFIXES: string[] = [
  "CMveMXLZMHAutbnNpC4GrZ29TgSWxNK1PS",
];

export interface BlocklistResult {
  isBlocked: boolean;
  reason?: string;
  source?: string;
}

export function checkAddressBlocklist(address: string): BlocklistResult {
  if (!address || address.length < 10) {
    return { isBlocked: false };
  }

  const normalizedAddress = address.trim();

  if (KNOWN_SCAM_ADDRESSES.has(normalizedAddress)) {
    return {
      isBlocked: true,
      reason: "This address has been flagged as a known scam/phishing address",
      source: "blocklist",
    };
  }

  for (const prefix of KNOWN_SCAM_PREFIXES) {
    if (normalizedAddress.startsWith(prefix)) {
      return {
        isBlocked: true,
        reason: "This address pattern is associated with known scams",
        source: "pattern",
      };
    }
  }

  return { isBlocked: false };
}

export function addToBlocklist(address: string): void {
  KNOWN_SCAM_ADDRESSES.add(address.trim());
}

export function isInBlocklist(address: string): boolean {
  return KNOWN_SCAM_ADDRESSES.has(address.trim());
}
