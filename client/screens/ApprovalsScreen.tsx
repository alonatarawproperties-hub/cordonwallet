import { useState, useEffect, useCallback } from "react";
import { View, StyleSheet, FlatList, Pressable, Alert, ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { useWallet } from "@/lib/wallet-context";
import { 
  ApprovalRecord, 
  listApprovals, 
  revokeApproval,
  estimateRevokeFee,
  getSpenderLabel,
  shortenAddress,
  formatAllowance,
} from "@/lib/approvals";
import { supportedChains } from "@/lib/blockchain/chains";

export default function ApprovalsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { activeWallet, policySettings } = useWallet();
  
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [revokingIds, setRevokingIds] = useState<Set<string>>(new Set());

  const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address;

  const loadApprovals = useCallback(async () => {
    if (!evmAddress) {
      setApprovals([]);
      setIsLoading(false);
      return;
    }

    try {
      const allApprovals: ApprovalRecord[] = [];
      
      for (const chain of supportedChains) {
        const chainApprovals = await listApprovals({
          owner: evmAddress as `0x${string}`,
          chainId: chain.chainId,
        });
        allApprovals.push(...chainApprovals);
      }

      const activeApprovals = allApprovals.filter(a => 
        a.status !== "revoked" && a.status !== "failed"
      );

      setApprovals(activeApprovals.sort((a, b) => b.createdAt - a.createdAt));
    } catch (error) {
      console.error("Failed to load approvals:", error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [evmAddress]);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadApprovals();
  };

  const handleRevoke = async (approval: ApprovalRecord) => {
    if (!activeWallet) return;

    try {
      const feeEstimate = await estimateRevokeFee(
        approval.chainId,
        approval.owner,
        approval.tokenAddress,
        approval.spender
      );

      Alert.alert(
        "Revoke Approval",
        `Are you sure you want to revoke access to your ${approval.tokenSymbol || "tokens"}?\n\nEstimated gas: ${feeEstimate.feeFormatted}`,
        [
          { text: "Cancel", style: "cancel" },
          { 
            text: "Revoke",
            style: "destructive",
            onPress: async () => {
              await executeRevoke(approval);
            }
          },
        ]
      );
    } catch (error) {
      Alert.alert(
        "Revoke Approval",
        `Are you sure you want to revoke access to your ${approval.tokenSymbol || "tokens"}?`,
        [
          { text: "Cancel", style: "cancel" },
          { 
            text: "Revoke",
            style: "destructive",
            onPress: async () => {
              await executeRevoke(approval);
            }
          },
        ]
      );
    }
  };

  const executeRevoke = async (approval: ApprovalRecord) => {
    if (!activeWallet) return;

    setRevokingIds(prev => new Set([...prev, approval.id]));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await revokeApproval({
        chainId: approval.chainId,
        walletId: activeWallet.id,
        owner: approval.owner,
        tokenAddress: approval.tokenAddress,
        spender: approval.spender,
        approvalId: approval.id,
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      Alert.alert(
        "Revoke Submitted",
        `Transaction submitted successfully!\n\nHash: ${result.hash.slice(0, 10)}...${result.hash.slice(-8)}`,
        [
          { text: "OK", onPress: () => loadApprovals() },
        ]
      );
    } catch (error: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Revoke Failed", error.message || "Failed to revoke approval");
    } finally {
      setRevokingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(approval.id);
        return newSet;
      });
    }
  };

  const getChainName = (chainId: number): string => {
    const chain = supportedChains.find(c => c.chainId === chainId);
    return chain?.name || `Chain ${chainId}`;
  };

  const unlimitedCount = approvals.filter(a => a.isUnlimited).length;
  const isBlockingUnlimited = policySettings.blockUnlimitedApprovals;

  const renderApproval = ({ item }: { item: ApprovalRecord }) => {
    const isBlocked = item.isUnlimited && isBlockingUnlimited;
    const isRevoking = revokingIds.has(item.id) || item.status === "revoking";
    const spenderLabel = item.spenderLabel || getSpenderLabel(item.chainId, item.spender);
    const displayAllowance = item.isUnlimited 
      ? "Unlimited" 
      : item.allowanceFormatted || formatAllowance(
          BigInt(item.allowanceRaw),
          item.tokenDecimals || 18,
          item.tokenSymbol || ""
        );
    
    return (
      <View style={[styles.approvalCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.approvalHeader}>
          <View style={[styles.tokenIcon, { backgroundColor: theme.accent + "15" }]}>
            <ThemedText type="body" style={{ fontWeight: "700", color: theme.accent }}>
              {(item.tokenSymbol || "??").slice(0, 2)}
            </ThemedText>
          </View>
          <View style={styles.tokenInfo}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {item.tokenSymbol || shortenAddress(item.tokenAddress)}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.tokenName || getChainName(item.chainId)}
            </ThemedText>
          </View>
          {item.status === "pending" ? (
            <Badge label="Pending" variant="warning" />
          ) : item.isUnlimited ? (
            <Badge label={isBlocked ? "Blocked" : "Unlimited"} variant="danger" />
          ) : (
            <Badge label={displayAllowance} variant="neutral" />
          )}
        </View>

        {isBlocked ? (
          <View style={[styles.blockedRow, { backgroundColor: theme.danger + "10", borderTopColor: theme.border }]}>
            <Feather name="shield-off" size={16} color={theme.danger} />
            <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>
              This approval is risky. Revoke it to stay safe.
            </ThemedText>
          </View>
        ) : null}

        <View style={[styles.spenderRow, { borderTopColor: theme.border }]}>
          <View style={styles.spenderInfo}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Approved Spender
            </ThemedText>
            <View style={styles.spenderName}>
              <ThemedText type="body">
                {spenderLabel || "Unknown Contract"}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {shortenAddress(item.spender)}
              </ThemedText>
            </View>
          </View>
          <Pressable 
            style={[
              styles.revokeButton, 
              { backgroundColor: isRevoking ? theme.border : theme.danger + "15" }
            ]}
            onPress={() => handleRevoke(item)}
            disabled={isRevoking}
          >
            {isRevoking ? (
              <ActivityIndicator size="small" color={theme.textSecondary} />
            ) : (
              <>
                <Feather name="x" size={16} color={theme.danger} />
                <ThemedText type="small" style={{ color: theme.danger, fontWeight: "600" }}>
                  Revoke
                </ThemedText>
              </>
            )}
          </Pressable>
        </View>
      </View>
    );
  };

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.loadingContainer, { paddingTop: headerHeight + Spacing.xl }]}>
          <ActivityIndicator size="large" color={theme.accent} />
          <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: Spacing.md }}>
            Loading approvals...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing["2xl"] },
        ]}
        data={approvals}
        keyExtractor={(item) => item.id}
        renderItem={renderApproval}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.accent}
          />
        }
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
                    {unlimitedCount} unlimited approval{unlimitedCount !== 1 ? "s" : ""} detected. New unlimited approvals will be blocked.
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

            {approvals.length > 0 ? (
              <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
                {approvals.length} approval{approvals.length !== 1 ? "s" : ""} tracked
              </ThemedText>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="No Approvals"
            message="Token approvals made from this wallet will appear here"
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
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
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
    minWidth: 80,
    justifyContent: "center",
  },
});
