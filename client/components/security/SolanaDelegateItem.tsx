import { View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { TokenDelegate } from "@/lib/solana/permissions";

interface SolanaDelegateItemProps {
  delegate: TokenDelegate;
  onRevoke: (tokenAccountAddress: string) => void;
  isRevoking?: boolean;
}

function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function SolanaDelegateItem({
  delegate,
  onRevoke,
  isRevoking = false,
}: SolanaDelegateItemProps) {
  const { theme } = useTheme();
  
  const formattedAmount = delegate.decimals
    ? (parseInt(delegate.delegatedAmount) / Math.pow(10, delegate.decimals)).toFixed(4)
    : delegate.delegatedAmount;

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}>
      <View style={styles.header}>
        <View style={styles.tokenInfo}>
          <View style={styles.tokenRow}>
            <Feather name="sun" size={24} color="#9945FF" />
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {delegate.tokenSymbol || shortenAddress(delegate.mint)}
            </ThemedText>
            <View style={[styles.chainBadge, { backgroundColor: "#9945FF" }]}>
              <ThemedText type="caption" style={styles.chainBadgeText}>
                Solana
              </ThemedText>
            </View>
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Delegate: {shortenAddress(delegate.delegate)}
          </ThemedText>
        </View>
        <View style={[styles.riskBadge, { backgroundColor: "#F59E0B20" }]}>
          <Feather name="alert-triangle" size={12} color="#F59E0B" />
          <ThemedText type="caption" style={{ color: "#F59E0B", fontWeight: "500" }}>
            Medium
          </ThemedText>
        </View>
      </View>

      <View style={styles.detailsRow}>
        <View style={styles.detail}>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Delegated Amount
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.text }}>
            {formattedAmount} {delegate.tokenSymbol || "tokens"}
          </ThemedText>
        </View>
        <ThemedText type="caption" style={{ color: theme.textSecondary, flex: 1, textAlign: "center", opacity: 0.7 }}>
          {delegate.riskReason}
        </ThemedText>
      </View>

      <Pressable
        style={[styles.actionButton, { backgroundColor: "#EF444420" }]}
        onPress={() => onRevoke(delegate.tokenAccount)}
        disabled={isRevoking}
      >
        {isRevoking ? (
          <ActivityIndicator size="small" color="#EF4444" />
        ) : (
          <>
            <Feather name="x-circle" size={14} color="#EF4444" />
            <ThemedText type="caption" style={{ color: "#EF4444", fontWeight: "600" }}>
              Revoke Delegate
            </ThemedText>
          </>
        )}
      </Pressable>
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
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
});
