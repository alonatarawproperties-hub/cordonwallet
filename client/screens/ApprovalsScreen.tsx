import { useState, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { useWallet } from "@/lib/wallet-context";
import { useEvmApprovals } from "@/hooks/useEvmApprovals";
import { useSolanaPermissions } from "@/hooks/useSolanaPermissions";
import {
  SecuritySummaryCard,
  EvmApprovalItem,
  SolanaSessionItem,
  SolanaDelegateItem,
  EmptyState,
} from "@/components/security";
import { revokeApproval, estimateRevokeFee } from "@/lib/approvals";
import type { EnrichedApproval } from "@/lib/approvals/discovery";

type SubTab = "evm" | "solana";

export default function ApprovalsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { activeWallet } = useWallet();
  
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("evm");
  const [revokingIds, setRevokingIds] = useState<Set<string>>(new Set());
  const [disconnectingTopics, setDisconnectingTopics] = useState<Set<string>>(new Set());
  const [revokingDelegates, setRevokingDelegates] = useState<Set<string>>(new Set());

  const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address;
  const solanaAddress = activeWallet?.addresses?.solana;
  const walletId = activeWallet?.id;

  const evmApprovals = useEvmApprovals(evmAddress);
  const solanaPermissions = useSolanaPermissions(solanaAddress, walletId);

  const isRefreshing = evmApprovals.isRefreshing || solanaPermissions.isRefreshing;
  const isLoading = evmApprovals.isLoading || solanaPermissions.isLoading;

  const handleRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (activeSubTab === "evm") {
      await evmApprovals.refresh();
    } else {
      await solanaPermissions.refresh();
    }
  }, [activeSubTab, evmApprovals, solanaPermissions]);

  const handleRevokeApproval = async (approval: EnrichedApproval) => {
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
                  `Transaction submitted!\n\nHash: ${result.hash.slice(0, 10)}...${result.hash.slice(-8)}`,
                  [{ text: "OK", onPress: () => evmApprovals.refresh() }]
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
            }
          },
        ]
      );
    } catch (error) {
      Alert.alert("Error", "Failed to estimate gas for revoke");
    }
  };

  const handleCapApproval = (approval: EnrichedApproval) => {
    Alert.alert(
      "Cap Allowance",
      `Set a limit for ${approval.tokenSymbol || "this token"} instead of unlimited access.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Set Cap", onPress: () => {
          Alert.alert("Coming Soon", "Cap allowance UI will be added in a future update");
        }},
      ]
    );
  };

  const handleDisconnectSession = async (topic: string) => {
    Alert.alert(
      "Disconnect dApp",
      "Are you sure you want to disconnect this dApp?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            setDisconnectingTopics(prev => new Set([...prev, topic]));
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            
            try {
              await solanaPermissions.disconnectSession(topic);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error: any) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert("Error", error.message || "Failed to disconnect session");
            } finally {
              setDisconnectingTopics(prev => {
                const newSet = new Set(prev);
                newSet.delete(topic);
                return newSet;
              });
            }
          }
        }
      ]
    );
  };

  const handleRevokeDelegate = async (tokenAccountAddress: string) => {
    Alert.alert(
      "Revoke Delegate",
      "Are you sure you want to revoke this token delegate?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: async () => {
            setRevokingDelegates(prev => new Set([...prev, tokenAccountAddress]));
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            
            try {
              const result = await solanaPermissions.revokeDelegate(tokenAccountAddress);
              if (result.success) {
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Alert.alert("Success", "Delegate revoked successfully");
              } else {
                throw new Error(result.error);
              }
            } catch (error: any) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert("Error", error.message || "Failed to revoke delegate");
            } finally {
              setRevokingDelegates(prev => {
                const newSet = new Set(prev);
                newSet.delete(tokenAccountAddress);
                return newSet;
              });
            }
          }
        }
      ]
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.md,
        paddingBottom: insets.bottom + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor={theme.accent}
          progressViewOffset={headerHeight}
        />
      }
    >
      <View style={[styles.subTabsContainer, { backgroundColor: theme.backgroundSecondary }]}>
        <Pressable
          style={[
            styles.subTab,
            activeSubTab === "evm" && { backgroundColor: theme.backgroundDefault },
          ]}
          onPress={() => setActiveSubTab("evm")}
        >
          <Feather 
            name="hexagon" 
            size={14} 
            color={activeSubTab === "evm" ? theme.text : theme.textSecondary} 
          />
          <ThemedText 
            type="small" 
            style={[styles.subTabText, activeSubTab === "evm" && { fontWeight: "600" }]}
          >
            EVM Approvals
          </ThemedText>
        </Pressable>
        <Pressable
          style={[
            styles.subTab,
            activeSubTab === "solana" && { backgroundColor: theme.backgroundDefault },
          ]}
          onPress={() => setActiveSubTab("solana")}
        >
          <Feather 
            name="sun" 
            size={14} 
            color={activeSubTab === "solana" ? "#9945FF" : theme.textSecondary} 
          />
          <ThemedText 
            type="small" 
            style={[styles.subTabText, activeSubTab === "solana" && { fontWeight: "600" }]}
          >
            Solana Permissions
          </ThemedText>
        </Pressable>
      </View>

      {activeSubTab === "evm" ? (
        <View>
          <SecuritySummaryCard
            type="evm"
            overallRisk={evmApprovals.riskSummary.overallRisk}
            totalCount={evmApprovals.riskSummary.totalCount}
            unlimitedCount={evmApprovals.riskSummary.unlimitedCount}
            highRiskCount={evmApprovals.riskSummary.highRiskCount}
            onFixRisky={evmApprovals.riskSummary.highRiskCount > 0 ? () => {
              const risky = evmApprovals.approvals.find(a => a.riskLevel === "high");
              if (risky) handleRevokeApproval(risky);
            } : undefined}
          />

          {evmApprovals.isLoading ? (
            <View style={styles.loadingContainer}>
              {[1, 2, 3].map((i) => (
                <View key={i} style={[styles.skeletonCard, { backgroundColor: theme.backgroundSecondary }]} />
              ))}
            </View>
          ) : evmApprovals.approvals.length === 0 ? (
            <EmptyState type="evm-approvals" />
          ) : (
            evmApprovals.approvals.map((approval) => (
              <EvmApprovalItem
                key={approval.id}
                approval={approval}
                onRevoke={handleRevokeApproval}
                onCap={handleCapApproval}
                isRevoking={revokingIds.has(approval.id)}
              />
            ))
          )}
        </View>
      ) : (
        <View>
          <SecuritySummaryCard
            type="solana"
            connectedDApps={solanaPermissions.summary.connectedDApps}
            tokenDelegates={solanaPermissions.summary.tokenDelegates}
            firewallActive={true}
          />

          <View style={styles.sectionHeader}>
            <Feather name="link-2" size={16} color={theme.text} />
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              Connected dApps
            </ThemedText>
          </View>

          {solanaPermissions.isLoading ? (
            <View style={[styles.skeletonCard, { backgroundColor: theme.backgroundSecondary }]} />
          ) : solanaPermissions.sessions.length === 0 ? (
            <EmptyState type="solana-sessions" />
          ) : (
            solanaPermissions.sessions.map((session) => (
              <SolanaSessionItem
                key={session.topic}
                session={session}
                onDisconnect={handleDisconnectSession}
                isDisconnecting={disconnectingTopics.has(session.topic)}
              />
            ))
          )}

          <View style={[styles.sectionHeader, { marginTop: Spacing.lg }]}>
            <Feather name="key" size={16} color={theme.text} />
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              Token Delegates
            </ThemedText>
          </View>

          {solanaPermissions.isLoading ? (
            <View style={[styles.skeletonCard, { backgroundColor: theme.backgroundSecondary }]} />
          ) : solanaPermissions.delegates.length === 0 ? (
            <EmptyState type="solana-delegates" />
          ) : (
            solanaPermissions.delegates.map((delegate) => (
              <SolanaDelegateItem
                key={delegate.id}
                delegate={delegate}
                onRevoke={handleRevokeDelegate}
                isRevoking={revokingDelegates.has(delegate.tokenAccount)}
              />
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  subTabsContainer: {
    flexDirection: "row",
    borderRadius: BorderRadius.lg,
    padding: 4,
    marginBottom: Spacing.lg,
  },
  subTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  subTabText: {
    textAlign: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  loadingContainer: {
    gap: Spacing.sm,
  },
  skeletonCard: {
    height: 120,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
});
