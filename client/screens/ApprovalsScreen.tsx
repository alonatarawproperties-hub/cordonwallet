import { useState, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert, RefreshControl, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { Badge } from "@/components/Badge";
import { useWallet } from "@/lib/wallet-context";
import { useWalletConnect } from "@/lib/walletconnect/context";
import { useEvmApprovals } from "@/hooks/useEvmApprovals";
import { useSolanaPermissions } from "@/hooks/useSolanaPermissions";
import {
  SecuritySummaryCard,
  EvmApprovalItem,
  SolanaDelegateItem,
  EmptyState,
} from "@/components/security";
import { revokeApproval, estimateRevokeFee } from "@/lib/approvals";
import type { EnrichedApproval } from "@/lib/approvals/discovery";
import { getFaviconUrl } from "@/store/browserStore";

type MainTab = "permissions" | "approvals";

export default function ApprovalsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { activeWallet } = useWallet();
  const { sessions, disconnect: wcDisconnect } = useWalletConnect();
  
  const [activeTab, setActiveTab] = useState<MainTab>("permissions");
  const [revokingIds, setRevokingIds] = useState<Set<string>>(new Set());
  const [disconnectingTopics, setDisconnectingTopics] = useState<Set<string>>(new Set());
  const [revokingDelegates, setRevokingDelegates] = useState<Set<string>>(new Set());

  const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address;
  const solanaAddress = activeWallet?.addresses?.solana;
  const walletId = activeWallet?.id;

  const evmApprovals = useEvmApprovals(evmAddress);
  const solanaPermissions = useSolanaPermissions(solanaAddress, walletId);

  const isRefreshing = evmApprovals.isRefreshing || solanaPermissions.isRefreshing;

  const handleRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Promise.all([
      evmApprovals.refresh(),
      solanaPermissions.refresh(),
    ]);
  }, [evmApprovals, solanaPermissions]);

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

  const handleDisconnectSession = async (topic: string, name: string) => {
    Alert.alert(
      "Disconnect dApp",
      `Are you sure you want to disconnect from ${name}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            setDisconnectingTopics(prev => new Set([...prev, topic]));
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            
            try {
              await wcDisconnect(topic);
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

  const getChainLabels = (chains: string[] | undefined): string => {
    if (!chains || chains.length === 0) return "Multi-chain";
    return chains.map(c => {
      if (c.startsWith("eip155:1")) return "Ethereum";
      if (c.startsWith("eip155:137")) return "Polygon";
      if (c.startsWith("eip155:56")) return "BNB";
      if (c.startsWith("solana:")) return "Solana";
      return c;
    }).join(", ");
  };

  const isSolanaSession = (session: typeof sessions[0]): boolean => {
    return session.chains?.some(chain => chain.startsWith("solana:")) || false;
  };

  const getSolanaEnrichedSession = (topic: string) => {
    return solanaPermissions.sessions.find(s => s.topic === topic);
  };

  const totalSessionCount = sessions.length;
  const solanaSessionCount = solanaPermissions.sessions.length;
  const evmSessionCount = sessions.filter(s => !isSolanaSession(s)).length;

  const renderPermissionsTab = () => (
    <View>
      <View style={[styles.summaryCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <ThemedText type="h2" style={{ color: theme.accent }}>
              {totalSessionCount}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Active Sessions
            </ThemedText>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.summaryItem}>
            <View style={styles.summaryDetails}>
              <View style={styles.summaryDetailRow}>
                <Feather name="hexagon" size={12} color={theme.textSecondary} />
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {evmSessionCount} EVM
                </ThemedText>
              </View>
              <View style={styles.summaryDetailRow}>
                <Feather name="sun" size={12} color="#9945FF" />
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {solanaSessionCount} Solana
                </ThemedText>
              </View>
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.summaryItem}>
            <Feather name="shield" size={24} color={theme.success} />
            <ThemedText type="caption" style={{ color: theme.success }}>
              Firewall Active
            </ThemedText>
          </View>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Feather name="link-2" size={16} color={theme.text} />
        <ThemedText type="body" style={{ fontWeight: "600" }}>
          Connected dApps
        </ThemedText>
        {totalSessionCount > 0 ? (
          <Badge label={`${totalSessionCount}`} variant="accent" />
        ) : null}
      </View>

      <ThemedText type="caption" style={[styles.sectionDescription, { color: theme.textSecondary }]}>
        WalletConnect sessions allow dApps to request signatures and transactions. Disconnecting removes their access.
      </ThemedText>

      {totalSessionCount === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="link" size={32} color={theme.textSecondary} />
          <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: Spacing.md }}>
            No active sessions
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
            Connect to dApps via WalletConnect to see them here
          </ThemedText>
        </View>
      ) : (
        sessions.map((session) => {
          const domain = session.peerMeta.url ? new URL(session.peerMeta.url).hostname : "Unknown";
          const isDisconnecting = disconnectingTopics.has(session.topic);
          const isSolana = isSolanaSession(session);
          const solanaEnriched = isSolana ? getSolanaEnrichedSession(session.topic) : null;
          const isVerified = solanaEnriched?.isVerified || false;
          
          return (
            <Pressable
              key={session.topic}
              style={[
                styles.sessionCard, 
                { 
                  backgroundColor: theme.backgroundDefault, 
                  borderColor: isSolana ? "#9945FF40" : theme.border,
                }
              ]}
              onPress={() => handleDisconnectSession(session.topic, session.peerMeta.name)}
              disabled={isDisconnecting}
              testID={`session-${session.topic}`}
            >
              <View style={styles.sessionCardContent}>
                {session.peerMeta.icons?.[0] ? (
                  <Image
                    source={{ uri: session.peerMeta.icons[0] }}
                    style={styles.sessionIcon}
                    defaultSource={{ uri: getFaviconUrl(session.peerMeta.url || "") }}
                  />
                ) : (
                  <View style={[styles.sessionIconFallback, { backgroundColor: isSolana ? "#9945FF20" : theme.accent + "20" }]}>
                    <ThemedText type="h4" style={{ color: isSolana ? "#9945FF" : theme.accent }}>
                      {session.peerMeta.name?.charAt(0) || "?"}
                    </ThemedText>
                  </View>
                )}
                <View style={styles.sessionInfo}>
                  <View style={styles.sessionNameRow}>
                    <ThemedText type="body" style={{ fontWeight: "600" }} numberOfLines={1}>
                      {session.peerMeta.name}
                    </ThemedText>
                    {isSolana && isVerified ? (
                      <Feather name="check-circle" size={14} color={theme.success} />
                    ) : null}
                  </View>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
                    {domain}
                  </ThemedText>
                  <View style={styles.chainBadges}>
                    {isSolana ? (
                      <View style={[styles.chainBadge, { backgroundColor: "#9945FF15" }]}>
                        <Feather name="sun" size={10} color="#9945FF" />
                        <ThemedText type="caption" style={{ color: "#9945FF", fontSize: 10 }}>
                          Solana
                        </ThemedText>
                      </View>
                    ) : null}
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      {getChainLabels(session.chains)}
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.sessionActions}>
                  <View style={styles.statusBadge}>
                    <View style={[styles.statusDot, { backgroundColor: theme.success }]} />
                    <ThemedText type="caption" style={{ color: theme.success }}>
                      Active
                    </ThemedText>
                  </View>
                  <Feather 
                    name={isDisconnecting ? "loader" : "x-circle"} 
                    size={20} 
                    color={isDisconnecting ? theme.textSecondary : theme.danger} 
                  />
                </View>
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );

  const renderApprovalsTab = () => (
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

      <View style={styles.sectionHeader}>
        <Feather name="hexagon" size={16} color={theme.text} />
        <ThemedText type="body" style={{ fontWeight: "600" }}>
          EVM Token Approvals
        </ThemedText>
        {evmApprovals.approvals.length > 0 ? (
          <Badge label={`${evmApprovals.approvals.length}`} variant="neutral" />
        ) : null}
      </View>

      <ThemedText type="caption" style={[styles.sectionDescription, { color: theme.textSecondary }]}>
        Token approvals allow smart contracts to spend your tokens. Unlimited approvals pose higher risk.
      </ThemedText>

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

      <View style={[styles.sectionHeader, { marginTop: Spacing.xl }]}>
        <Feather name="sun" size={16} color="#9945FF" />
        <ThemedText type="body" style={{ fontWeight: "600" }}>
          Solana Token Delegates
        </ThemedText>
        {solanaPermissions.delegates.length > 0 ? (
          <Badge label={`${solanaPermissions.delegates.length}`} variant="neutral" />
        ) : null}
      </View>

      <ThemedText type="caption" style={[styles.sectionDescription, { color: theme.textSecondary }]}>
        Solana token delegates can transfer tokens on your behalf. Revoke unused delegates for security.
      </ThemedText>

      {solanaPermissions.isLoading ? (
        <View style={[styles.skeletonCard, { backgroundColor: theme.backgroundSecondary }]} />
      ) : solanaPermissions.delegates.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="check-circle" size={32} color={theme.success} />
          <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: Spacing.md }}>
            No active delegates
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
            Your Solana tokens have no third-party delegates
          </ThemedText>
        </View>
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
  );

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
      <View style={[styles.tabsContainer, { backgroundColor: theme.backgroundSecondary }]}>
        <Pressable
          style={[
            styles.tab,
            activeTab === "permissions" && { backgroundColor: theme.backgroundDefault },
          ]}
          onPress={() => setActiveTab("permissions")}
          testID="permissions-tab"
        >
          <Feather 
            name="link-2" 
            size={14} 
            color={activeTab === "permissions" ? theme.accent : theme.textSecondary} 
          />
          <ThemedText 
            type="small" 
            style={[styles.tabText, activeTab === "permissions" && { fontWeight: "600", color: theme.text }]}
          >
            Permissions
          </ThemedText>
          {sessions.length > 0 ? (
            <View style={[styles.tabBadge, { backgroundColor: theme.accent }]}>
              <ThemedText type="caption" style={{ color: "#fff", fontSize: 10 }}>
                {sessions.length}
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          style={[
            styles.tab,
            activeTab === "approvals" && { backgroundColor: theme.backgroundDefault },
          ]}
          onPress={() => setActiveTab("approvals")}
          testID="approvals-tab"
        >
          <Feather 
            name="key" 
            size={14} 
            color={activeTab === "approvals" ? theme.accent : theme.textSecondary} 
          />
          <ThemedText 
            type="small" 
            style={[styles.tabText, activeTab === "approvals" && { fontWeight: "600", color: theme.text }]}
          >
            Token Approvals
          </ThemedText>
          {evmApprovals.riskSummary.highRiskCount > 0 ? (
            <View style={[styles.tabBadge, { backgroundColor: theme.danger }]}>
              <ThemedText type="caption" style={{ color: "#fff", fontSize: 10 }}>
                {evmApprovals.riskSummary.highRiskCount}
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
      </View>

      {activeTab === "permissions" ? renderPermissionsTab() : renderApprovalsTab()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tabsContainer: {
    flexDirection: "row",
    borderRadius: BorderRadius.lg,
    padding: 4,
    marginBottom: Spacing.lg,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  tabText: {
    textAlign: "center",
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  summaryCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.lg,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
    gap: Spacing.xs,
  },
  divider: {
    width: 1,
    height: 40,
    marginHorizontal: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  sectionDescription: {
    marginBottom: Spacing.lg,
    lineHeight: 18,
  },
  loadingContainer: {
    gap: Spacing.sm,
  },
  skeletonCard: {
    height: 120,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
  emptyCard: {
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    gap: Spacing.xs,
  },
  sessionCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  sessionCardContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  sessionIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
  },
  sessionIconFallback: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionInfo: {
    flex: 1,
    gap: 2,
  },
  sessionNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  sessionActions: {
    alignItems: "flex-end",
    gap: Spacing.sm,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  summaryDetails: {
    gap: Spacing.xs,
  },
  summaryDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  chainBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.xs,
  },
  chainBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
