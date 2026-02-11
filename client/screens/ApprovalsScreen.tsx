import { useCallback, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Alert,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { useWallet } from "@/lib/wallet-context";
import { useSolanaPermissions } from "@/hooks/useSolanaPermissions";
import {
  EmptyState,
  SolanaDelegateItem,
  SolanaSessionItem,
} from "@/components/security";
import {
  getFaviconUrl,
  useBrowserStore,
  type ConnectedDApp,
} from "@/store/browserStore";

type SecurityTab = "dapps" | "delegates";

function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function ApprovalsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { activeWallet } = useWallet();
  const { connectedDApps, removeConnectedDApp } = useBrowserStore();

  const [activeTab, setActiveTab] = useState<SecurityTab>("dapps");
  const [disconnectingBrowserDApps, setDisconnectingBrowserDApps] = useState<
    Set<string>
  >(new Set());
  const [revokingDelegates, setRevokingDelegates] = useState<Set<string>>(
    new Set(),
  );
  const [disconnectingSessions, setDisconnectingSessions] = useState<
    Set<string>
  >(new Set());

  const solanaAddress =
    activeWallet?.addresses?.solana || activeWallet?.address;
  const walletId = activeWallet?.id;

  const permissions = useSolanaPermissions(solanaAddress, walletId);

  const solanaBrowserDapps = useMemo(
    () => connectedDApps.filter((dapp) => dapp.chain === "solana"),
    [connectedDApps],
  );

  const totalDAppConnections =
    permissions.sessions.length + solanaBrowserDapps.length;

  const handleRefresh = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await permissions.refresh();
  }, [permissions]);

  const handleDisconnectSession = useCallback(
    async (topic: string, name: string) => {
      Alert.alert(
        "Disconnect dApp",
        `Disconnect ${name}? This app will no longer be able to request signatures.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Disconnect",
            style: "destructive",
            onPress: async () => {
              setDisconnectingSessions((prev) => new Set([...prev, topic]));
              try {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                await permissions.disconnectSession(topic);
              } catch (error: any) {
                Alert.alert(
                  "Disconnect failed",
                  error?.message || "Please try again.",
                );
              } finally {
                setDisconnectingSessions((prev) => {
                  const next = new Set(prev);
                  next.delete(topic);
                  return next;
                });
              }
            },
          },
        ],
      );
    },
    [permissions],
  );

  const handleDisconnectBrowserDApp = useCallback(
    async (dapp: ConnectedDApp) => {
      Alert.alert(
        "Disconnect dApp",
        `Disconnect ${dapp.name}? This removes the stored browser connection for ${shortenAddress(
          dapp.walletAddress,
        )}.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Disconnect",
            style: "destructive",
            onPress: async () => {
              setDisconnectingBrowserDApps(
                (prev) => new Set([...prev, dapp.id]),
              );
              try {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                await removeConnectedDApp(dapp.id);
              } catch (error: any) {
                Alert.alert(
                  "Disconnect failed",
                  error?.message || "Please try again.",
                );
              } finally {
                setDisconnectingBrowserDApps((prev) => {
                  const next = new Set(prev);
                  next.delete(dapp.id);
                  return next;
                });
              }
            },
          },
        ],
      );
    },
    [removeConnectedDApp],
  );

  const handleRevokeDelegate = useCallback(
    async (tokenAccountAddress: string) => {
      setRevokingDelegates((prev) => new Set([...prev, tokenAccountAddress]));
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const result = await permissions.revokeDelegate(tokenAccountAddress);
        if (!result.success) {
          throw new Error(result.error || "Failed to revoke delegate");
        }
      } catch (error: any) {
        Alert.alert("Revoke failed", error?.message || "Please try again.");
      } finally {
        setRevokingDelegates((prev) => {
          const next = new Set(prev);
          next.delete(tokenAccountAddress);
          return next;
        });
      }
    },
    [permissions],
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
          refreshing={permissions.isRefreshing}
          onRefresh={handleRefresh}
          tintColor={theme.accent}
        />
      }
    >
      <View
        style={[
          styles.summaryCard,
          { backgroundColor: theme.backgroundSecondary },
        ]}
      >
        <View style={styles.summaryHeader}>
          <Feather name="shield" size={16} color="#22C55E" />
          <ThemedText
            type="small"
            style={{ color: "#22C55E", fontWeight: "600" }}
          >
            Signature Access
          </ThemedText>
        </View>
        <View style={styles.summaryStats}>
          <View style={styles.statItem}>
            <ThemedText type="h3">{totalDAppConnections}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Connected dApps
            </ThemedText>
          </View>
          <View style={styles.statItem}>
            <ThemedText type="h3">{permissions.delegates.length}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Token delegates
            </ThemedText>
          </View>
        </View>
      </View>

      <View
        style={[
          styles.tabsContainer,
          { backgroundColor: theme.backgroundSecondary },
        ]}
      >
        <Pressable
          style={[
            styles.tab,
            activeTab === "dapps" && {
              backgroundColor: theme.backgroundDefault,
            },
          ]}
          onPress={() => setActiveTab("dapps")}
        >
          <ThemedText
            type="small"
            style={activeTab === "dapps" ? { fontWeight: "600" } : undefined}
          >
            dApp Signatures
          </ThemedText>
        </Pressable>
        <Pressable
          style={[
            styles.tab,
            activeTab === "delegates" && {
              backgroundColor: theme.backgroundDefault,
            },
          ]}
          onPress={() => setActiveTab("delegates")}
        >
          <ThemedText
            type="small"
            style={
              activeTab === "delegates" ? { fontWeight: "600" } : undefined
            }
          >
            Contract Approvals
          </ThemedText>
        </Pressable>
      </View>

      {activeTab === "dapps" ? (
        <View style={styles.section}>
          {solanaBrowserDapps.map((dapp) => (
            <View
              key={`browser-${dapp.id}`}
              style={[
                styles.browserDappCard,
                { backgroundColor: theme.backgroundSecondary },
              ]}
            >
              <View style={styles.browserDappHeader}>
                {dapp.favicon ? (
                  <Image
                    source={{ uri: dapp.favicon }}
                    style={styles.browserIcon}
                  />
                ) : (
                  <Image
                    source={{ uri: getFaviconUrl(dapp.url) }}
                    style={styles.browserIcon}
                  />
                )}
                <View style={{ flex: 1 }}>
                  <ThemedText
                    type="body"
                    style={{ fontWeight: "600" }}
                    numberOfLines={1}
                  >
                    {dapp.name}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: theme.textSecondary }}
                    numberOfLines={1}
                  >
                    {dapp.url}
                  </ThemedText>
                </View>
              </View>
              <Pressable
                style={[styles.disconnectButton, { borderColor: theme.danger }]}
                onPress={() => handleDisconnectBrowserDApp(dapp)}
                disabled={disconnectingBrowserDApps.has(dapp.id)}
              >
                <Feather name="log-out" size={14} color={theme.danger} />
                <ThemedText
                  type="caption"
                  style={{ color: theme.danger, fontWeight: "600" }}
                >
                  {disconnectingBrowserDApps.has(dapp.id)
                    ? "Disconnecting..."
                    : "Disconnect"}
                </ThemedText>
              </Pressable>
            </View>
          ))}

          {permissions.sessions.map((session) => (
            <SolanaSessionItem
              key={`wc-${session.topic}`}
              session={session}
              onDisconnect={(topic) =>
                handleDisconnectSession(topic, session.peerMeta.name)
              }
              isDisconnecting={disconnectingSessions.has(session.topic)}
            />
          ))}

          {totalDAppConnections === 0 ? (
            <EmptyState type="solana-sessions" />
          ) : null}
        </View>
      ) : (
        <View style={styles.section}>
          {permissions.delegates.length > 0 ? (
            permissions.delegates.map((delegate) => (
              <SolanaDelegateItem
                key={delegate.tokenAccount}
                delegate={delegate}
                onRevoke={handleRevokeDelegate}
                isRevoking={revokingDelegates.has(delegate.tokenAccount)}
              />
            ))
          ) : (
            <EmptyState type="solana-delegates" />
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  summaryStats: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
  },
  tabsContainer: {
    flexDirection: "row",
    padding: 3,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  section: {
    gap: Spacing.sm,
  },
  browserDappCard: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  browserDappHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  browserIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
  },
  disconnectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
});
