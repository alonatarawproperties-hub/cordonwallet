import { decodeFunctionData, parseAbi } from "viem";
import { DetectedApproval, MAX_UINT256, isUnlimitedAllowance } from "./types";

const ERC20_APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export function detectApproveIntent(
  to: `0x${string}`,
  data: `0x${string}`
): DetectedApproval | null {
  if (!data || data === "0x" || data.length < 10) {
    return null;
  }

  const selector = data.slice(0, 10).toLowerCase();
  
  if (selector !== "0x095ea7b3") {
    return null;
  }

  try {
    const decoded = decodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      data,
    });

    if (decoded.functionName !== "approve" || !decoded.args) {
      return null;
    }

    const [spender, amount] = decoded.args as [`0x${string}`, bigint];

    return {
      tokenAddress: to,
      spender,
      amountRaw: amount,
      isUnlimited: isUnlimitedAllowance(amount),
    };
  } catch (error) {
    console.error("[Approvals] Failed to decode approve data:", error);
    return null;
  }
}

export function encodeApproveData(
  spender: `0x${string}`,
  amount: bigint
): `0x${string}` {
  const amountHex = amount.toString(16).padStart(64, "0");
  const spenderPadded = spender.slice(2).toLowerCase().padStart(64, "0");
  
  return `0x095ea7b3${spenderPadded}${amountHex}` as `0x${string}`;
}

export function encodeRevokeData(spender: `0x${string}`): `0x${string}` {
  return encodeApproveData(spender, 0n);
}

export { MAX_UINT256, isUnlimitedAllowance };
