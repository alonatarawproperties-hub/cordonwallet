export type RiskLevel = "safe" | "caution" | "risky";

export function getRiskColor(risk: RiskLevel): string {
  switch (risk) {
    case "safe": return "#22C55E";
    case "caution": return "#F59E0B";
    case "risky": return "#EF4444";
  }
}

export function getRiskIcon(risk: RiskLevel): string {
  switch (risk) {
    case "safe": return "check-circle";
    case "caution": return "alert-triangle";
    case "risky": return "alert-octagon";
  }
}
