import { View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import { shortenAddress } from "@/lib/approvals/spenders";
import type { EnrichedApproval, RiskLevel } from "@/lib/approvals/discovery";
import { getChainById } from "@/lib/blockchain/chains";

interface EvmApprovalItemProps {
  approval: EnrichedApproval;
  onRevoke: (approval: EnrichedApproval) => void;
  onCap: (approval: EnrichedApproval) => void;
  isRevoking?: boolean;
}

const riskColors: Record<RiskLevel, string> = {
  high: "#EF4444",
  medium: "#F59E0B",
  low: "#22C55E",
};

const riskIcons: Record<RiskLevel, keyof typeof Feather.glyphMap> = {
  high: "alert-circle",
  medium: "alert-triangle",
  low: "check-circle",
};

function getChainBadgeColor(chainId: number): string {
  const colors: Record<number, string> = {
    1: "#627EEA",
    137: "#8247E5",
    56: "#F3BA2F",
  };
  return colors[chainId] || "#888";
}

export function EvmApprovalItem({
  approval,
  onRevoke,
  onCap,
  isRevoking = false,
}: EvmApprovalItemProps) {
  const { theme } = useTheme();
  const chain = getChainById(approval.chainId);
  const riskColor = riskColors[approval.riskLevel];

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}>
      <View style={styles.header}>
        <View style={styles.tokenInfo}>
          <View style={styles.tokenRow}>
            <Feather name="disc" size={24} color={theme.text} />
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {approval.tokenSymbol || "Unknown Token"}
            </ThemedText>
            <View style={[styles.chainBadge, { backgroundColor: getChainBadgeColor(approval.chainId) }]}>
              <ThemedText type="caption" style={styles.chainBadgeText}>
                {chain?.name || `Chain ${approval.chainId}`}
              </ThemedText>
            </View>
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {approval.spenderLabel || "Unknown spender"} • {shortenAddress(approval.spender)}
          </ThemedText>
        </View>
        <View style={[styles.riskBadge, { backgroundColor: `${riskColor}20` }]}>
          <Feather name={riskIcons[approval.riskLevel]} size={12} color={riskColor} />
          <ThemedText type="caption" style={{ color: riskColor, fontWeight: "500" }}>
            {approval.riskLevel.charAt(0).toUpperCase() + approval.riskLevel.slice(1)}
          </ThemedText>
        </View>
      </View>

      <View style={styles.detailsRow}>
        <View style={styles.detail}>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Allowance
          </ThemedText>
          <ThemedText type="body" style={{ color: approval.isUnlimited ? "#F59E0B" : theme.text }}>
            {approval.isUnlimited ? "Unlimited" : approval.allowanceFormatted || "Capped"}
          </ThemedText>
        </View>
        <ThemedText type="caption" style={{ color: theme.textSecondary, flex: 1, textAlign: "center", opacity: 0.7 }}>
          {approval.riskReason}
        </ThemedText>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.actionButton, { backgroundColor: "#EF444420" }]}
          onPress={() => onRevoke(approval)}
          disabled={isRevoking}
        >
          {isRevoking ? (
            <ActivityIndicator size="small" color="#EF4444" />
          ) : (
            <>
              <Feather name="x-circle" size={14} color="#EF4444" />
              <ThemedText type="caption" style={{ color: "#EF4444", fontWeight: "600" }}>
                Revoke
              </ThemedText>
            </>
          )}
        </Pressable>
        {approval.isUnlimited ? (
          <Pressable
            style={[styles.actionButton, { backgroundColor: "#3B82F620" }]}
            onPress={() => onCap(approval)}
            disabled={isRevoking}
          >
            <Feather name="edit-2" size={14} color="#3B82F6" />
            <ThemedText type="caption" style={{ color: "#3B82F6", fontWeight: "600" }}>
              Cap
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: Spacing.sm,
  },
  tokenInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  chainBadge: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  chainBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "600",
  },
  riskBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  detailsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  detail: {
    gap: 2,
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
});
