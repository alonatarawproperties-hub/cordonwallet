import { SafetyFinding, TokenSafetyVerdict } from "@/types/tokenSafety";

export function computeVerdict(findings: SafetyFinding[]): TokenSafetyVerdict {
  const verifiedDangers = findings.filter(
    (f) => f.level === "danger" && f.verified === "verified"
  );
  const verifiedWarnings = findings.filter(
    (f) => f.level === "warning" && f.verified === "verified"
  );
  const allDangers = findings.filter((f) => f.level === "danger");
  const allWarnings = findings.filter((f) => f.level === "warning");

  const topReasons: string[] = [];
  for (const f of [...verifiedDangers, ...verifiedWarnings, ...allDangers, ...allWarnings]) {
    if (topReasons.length >= 4) break;
    if (!topReasons.includes(f.summary)) {
      topReasons.push(f.summary);
    }
  }

  if (verifiedDangers.length > 0) {
    return {
      label: "High Risk",
      level: "danger",
      reasons: topReasons,
    };
  }

  if (verifiedWarnings.length >= 2 || allDangers.length > 0) {
    return {
      label: "Medium Risk",
      level: "warning",
      reasons: topReasons,
    };
  }

  if (verifiedWarnings.length >= 1) {
    return {
      label: "Medium Risk",
      level: "warning",
      reasons: topReasons.length > 0 ? topReasons : ["Minor concerns detected"],
    };
  }

  return {
    label: "Low Risk",
    level: "safe",
    reasons: topReasons.length > 0 ? topReasons : ["No major issues detected"],
  };
}
