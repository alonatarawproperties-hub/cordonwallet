import { View, StyleSheet, FlatList, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { useWallet } from "@/lib/wallet-context";

interface MockApproval {
  id: string;
  tokenSymbol: string;
  tokenName: string;
  spenderName: string;
  spenderAddress: string;
  allowance: string;
  isUnlimited: boolean;
}

const MOCK_APPROVALS: MockApproval[] = [
  { id: "1", tokenSymbol: "USDC", tokenName: "USD Coin", spenderName: "Uniswap V3", spenderAddress: "0x68b3...4f21", allowance: "Unlimited", isUnlimited: true },
  { id: "2", tokenSymbol: "DAI", tokenName: "Dai Stablecoin", spenderName: "Aave V3", spenderAddress: "0x7fc9...8e32", allowance: "10,000", isUnlimited: false },
  { id: "3", tokenSymbol: "WETH", tokenName: "Wrapped Ether", spenderName: "1inch Router", spenderAddress: "0x1111...1111", allowance: "Unlimited", isUnlimited: true },
];

export default function ApprovalsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { policySettings } = useWallet();

  const handleRevoke = (approval: MockApproval) => {
    Alert.alert(
      "Revoke Approval",
      `Are you sure you want to revoke ${approval.spenderName}'s access to your ${approval.tokenSymbol}?\n\nEstimated gas: ~0.001 ETH ($2.50)`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Revoke",
          style: "destructive",
          onPress: () => {
            Alert.alert("Success", "Approval revoked successfully!");
          }
        },
      ]
    );
  };

  const unlimitedCount = MOCK_APPROVALS.filter(a => a.isUnlimited).length;
  const isBlockingUnlimited = policySettings.blockUnlimitedApprovals;

  const renderApproval = ({ item }: { item: MockApproval }) => {
    const isBlocked = item.isUnlimited && isBlockingUnlimited;
    
    return (
      <View style={[styles.approvalCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.approvalHeader}>
          <View style={[styles.tokenIcon, { backgroundColor: theme.accent + "15" }]}>
            <ThemedText type="body" style={{ fontWeight: "700", color: theme.accent }}>
              {item.tokenSymbol.slice(0, 2)}
            </ThemedText>
          </View>
          <View style={styles.tokenInfo}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {item.tokenSymbol}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.tokenName}
            </ThemedText>
          </View>
          {item.isUnlimited ? (
            <Badge label={isBlocked ? "Blocked" : "Unlimited"} variant="danger" />
          ) : (
            <Badge label={item.allowance} variant="neutral" />
          )}
        </View>

        {isBlocked ? (
          <View style={[styles.blockedRow, { backgroundColor: theme.danger + "10", borderTopColor: theme.border }]}>
            <Feather name="shield-off" size={16} color={theme.danger} />
            <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>
              This approval is blocked by your Wallet Firewall policy. Revoke it to stay safe.
            </ThemedText>
          </View>
        ) : null}

        <View style={[styles.spenderRow, { borderTopColor: theme.border }]}>
          <View style={styles.spenderInfo}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Approved Spender
            </ThemedText>
            <View style={styles.spenderName}>
              <ThemedText type="body">{item.spenderName}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {item.spenderAddress}
              </ThemedText>
            </View>
          </View>
          <Pressable 
            style={[styles.revokeButton, { backgroundColor: theme.danger + "15" }]}
            onPress={() => handleRevoke(item)}
          >
            <Feather name="x" size={16} color={theme.danger} />
            <ThemedText type="small" style={{ color: theme.danger, fontWeight: "600" }}>
              Revoke
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <FlatList
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing["2xl"] },
        ]}
        data={MOCK_APPROVALS}
        keyExtractor={(item) => item.id}
        renderItem={renderApproval}
        ListHeaderComponent={
          <View>
            {isBlockingUnlimited && unlimitedCount > 0 ? (
              <View style={[styles.policyCard, { backgroundColor: theme.accent + "15", borderColor: theme.accent + "40" }]}>
                <Feather name="shield" size={20} color={theme.accent} />
                <View style={styles.policyContent}>
                  <ThemedText type="body" style={{ color: theme.accent, fontWeight: "600" }}>
                    Wallet Firewall Active
                  </ThemedText>
                  <ThemedText type="small" style={{ color: theme.accent }}>
                    {unlimitedCount} unlimited approval{unlimitedCount !== 1 ? "s" : ""} blocked by policy. New unlimited approvals will be rejected.
                  </ThemedText>
                </View>
              </View>
            ) : null}
            
            {unlimitedCount > 0 && !isBlockingUnlimited ? (
              <View style={[styles.warningCard, { backgroundColor: theme.danger + "15", borderColor: theme.danger + "40" }]}>
                <Feather name="alert-triangle" size={20} color={theme.danger} />
                <View style={styles.warningContent}>
                  <ThemedText type="body" style={{ color: theme.danger, fontWeight: "600" }}>
                    {unlimitedCount} Unlimited Approvals
                  </ThemedText>
                  <ThemedText type="small" style={{ color: theme.danger }}>
                    These contracts can spend all your tokens. Consider revoking unnecessary approvals or enabling the block policy.
                  </ThemedText>
                </View>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="No Approvals"
            message="You haven't approved any contracts to spend your tokens"
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  policyCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  policyContent: {
    flex: 1,
    gap: Spacing.xs,
  },
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  warningContent: {
    flex: 1,
    gap: Spacing.xs,
  },
  approvalCard: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  approvalHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  tokenIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tokenInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  blockedRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderTopWidth: 1,
    gap: Spacing.sm,
  },
  spenderRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    gap: Spacing.md,
  },
  spenderInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  spenderName: {
    gap: Spacing.xs,
  },
  revokeButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
  },
});
