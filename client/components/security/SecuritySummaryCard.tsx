import { View, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { RiskLevel } from "@/lib/approvals/discovery";

interface SecuritySummaryCardProps {
  type: "evm" | "solana";
  overallRisk?: RiskLevel;
  totalCount?: number;
  unlimitedCount?: number;
  highRiskCount?: number;
  connectedDApps?: number;
  tokenDelegates?: number;
  firewallActive?: boolean;
  onFixRisky?: () => void;
}

const riskColors = {
  high: "#EF4444",
  medium: "#F59E0B",
  low: "#22C55E",
};

const riskLabels = {
  high: "High Risk",
  medium: "Medium Risk",
  low: "Low Risk",
};

export function SecuritySummaryCard({
  type,
  overallRisk = "low",
  totalCount = 0,
  unlimitedCount = 0,
  highRiskCount = 0,
  connectedDApps = 0,
  tokenDelegates = 0,
  firewallActive = true,
  onFixRisky,
}: SecuritySummaryCardProps) {
  const { theme } = useTheme();
  const riskColor = riskColors[overallRisk];

  if (type === "evm") {
    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}>
        <View style={styles.row}>
          <View style={styles.riskBadge}>
            <Feather
              name={overallRisk === "low" ? "shield" : "alert-triangle"}
              size={16}
              color={riskColor}
            />
            <ThemedText type="caption" style={[styles.riskText, { color: riskColor }]}>
              {riskLabels[overallRisk]}
            </ThemedText>
          </View>
          {(highRiskCount > 0 || unlimitedCount > 0) && onFixRisky ? (
            <Pressable onPress={onFixRisky} style={[styles.fixButton, { backgroundColor: riskColor }]}>
              <ThemedText type="caption" style={styles.fixButtonText}>
                Fix risky approvals
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <ThemedText type="h3" style={{ color: theme.text }}>
              {totalCount}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Active approvals
            </ThemedText>
          </View>
          <View style={styles.stat}>
            <ThemedText type="h3" style={{ color: unlimitedCount > 0 ? "#F59E0B" : theme.text }}>
              {unlimitedCount}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Unlimited
            </ThemedText>
          </View>
          <View style={styles.stat}>
            <ThemedText type="h3" style={{ color: highRiskCount > 0 ? "#EF4444" : theme.text }}>
              {highRiskCount}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              High risk
            </ThemedText>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}>
      <View style={styles.row}>
        <View style={styles.riskBadge}>
          <Feather name="shield" size={16} color={firewallActive ? "#22C55E" : theme.textSecondary} />
          <ThemedText type="caption" style={{ color: firewallActive ? "#22C55E" : theme.textSecondary }}>
            {firewallActive ? "Firewall Active" : "Firewall Off"}
          </ThemedText>
        </View>
      </View>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <ThemedText type="h3" style={{ color: theme.text }}>
            {connectedDApps}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Connected dApps
          </ThemedText>
        </View>
        <View style={styles.stat}>
          <ThemedText type="h3" style={{ color: tokenDelegates > 0 ? "#F59E0B" : theme.text }}>
            {tokenDelegates}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Token delegates
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  riskBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  riskText: {
    fontWeight: "600",
  },
  fixButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  fixButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  stat: {
    alignItems: "center",
  },
});
