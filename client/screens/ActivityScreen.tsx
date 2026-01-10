import { useState, useCallback } from "react";
import { View, StyleSheet, SectionList, Pressable, RefreshControl } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as WebBrowser from "expo-web-browser";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { useWallet } from "@/lib/wallet-context";
import { TxRecord, ActivityType, getTransactionsByWallet } from "@/lib/transaction-history";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  fetchAllChainsHistory,
  groupTransactionsByDate,
} from "@/lib/blockchain/explorer-api";
import { supportedChains, getChainById, getExplorerAddressUrl } from "@/lib/blockchain/chains";
import { NetworkId } from "@/lib/types";

const NETWORK_TO_CHAIN_ID: Record<NetworkId, number> = {
  ethereum: 1,
  polygon: 137,
  bsc: 56,
};

type NetworkFilter = "all" | number;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function ActivityScreen() {
  const navigation = useNavigation<NavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { activeWallet, selectedNetwork } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>("all");
  const [showNetworkPicker, setShowNetworkPicker] = useState(false);

  const loadTransactions = useCallback(async () => {
    if (!activeWallet) {
      console.log("[Activity] No active wallet");
      setTransactions([]);
      setLoading(false);
      return;
    }

    console.log("[Activity] Loading transactions for:", activeWallet.address);

    try {
      const [explorerTxs, localTxs] = await Promise.all([
        fetchAllChainsHistory(activeWallet.address),
        getTransactionsByWallet(activeWallet.address),
      ]);

      console.log("[Activity] Explorer txs:", explorerTxs.length, "Local txs:", localTxs.length);

      const explorerHashes = new Set(explorerTxs.map((tx) => tx.hash.toLowerCase()));
      const uniqueLocalTxs = localTxs.filter(
        (tx) => !explorerHashes.has(tx.hash.toLowerCase())
      );

      const allTxs = [...uniqueLocalTxs, ...explorerTxs];
      allTxs.sort((a, b) => b.createdAt - a.createdAt);

      console.log("[Activity] Total transactions:", allTxs.length);
      setTransactions(allTxs.slice(0, 100));
    } catch (error) {
      console.error("[Activity] Failed to load transactions:", error);
      const localTxs = await getTransactionsByWallet(activeWallet.address);
      setTransactions(localTxs);
    } finally {
      setLoading(false);
    }
  }, [activeWallet]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadTransactions();
    }, [loadTransactions])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTransactions();
    setRefreshing(false);
  }, [loadTransactions]);

  const filteredTransactions =
    networkFilter === "all"
      ? transactions
      : transactions.filter((tx) => tx.chainId === networkFilter);

  const groupedData = groupTransactionsByDate(filteredTransactions);

  const getActivityIcon = (activityType: ActivityType): keyof typeof Feather.glyphMap => {
    switch (activityType) {
      case "send":
        return "arrow-up";
      case "receive":
        return "arrow-down";
      case "swap":
        return "repeat";
    }
  };

  const getActivityColor = (activityType: ActivityType) => {
    switch (activityType) {
      case "send":
        return theme.text;
      case "receive":
        return theme.success;
      case "swap":
        return theme.warning;
    }
  };

  const getActivityLabel = (activityType: ActivityType) => {
    switch (activityType) {
      case "send":
        return "Send";
      case "receive":
        return "Receive";
      case "swap":
        return "Swap";
    }
  };

  const handleTransactionPress = (tx: TxRecord) => {
    navigation.navigate("TransactionDetail", {
      hash: tx.hash,
      chainId: tx.chainId,
      activityType: tx.activityType,
      tokenSymbol: tx.tokenSymbol,
      amount: tx.amount,
      to: tx.to,
      from: tx.from,
      status: tx.status,
      createdAt: tx.createdAt,
      explorerUrl: tx.explorerUrl,
    });
  };

  const handleCheckExplorer = async () => {
    if (!activeWallet) return;
    const chainId = networkFilter === "all" 
      ? NETWORK_TO_CHAIN_ID[selectedNetwork] 
      : networkFilter;
    const url = getExplorerAddressUrl(chainId, activeWallet.address);
    if (url) {
      await WebBrowser.openBrowserAsync(url);
    }
  };

  const getNetworkName = (filter: NetworkFilter) => {
    if (filter === "all") return "All networks";
    const chain = getChainById(filter);
    return chain?.name || "Unknown";
  };

  const renderTransaction = ({ item }: { item: TxRecord }) => {
    const activityType = item.activityType || "send";
    const activityIcon = getActivityIcon(activityType);
    const activityLabel = getActivityLabel(activityType);
    const chain = getChainById(item.chainId);

    const getSubtitle = () => {
      if (activityType === "send") {
        const truncatedTo = `${item.to.slice(0, 8)}...${item.to.slice(-6)}`;
        return `To: ${truncatedTo}`;
      } else if (activityType === "receive" && item.from) {
        const truncatedFrom = `${item.from.slice(0, 8)}...${item.from.slice(-6)}`;
        return `From: ${truncatedFrom}`;
      } else if (activityType === "swap" && item.toTokenSymbol) {
        return `${item.tokenSymbol} → ${item.toTokenSymbol}`;
      }
      return "";
    };

    const getAmountDisplay = () => {
      if (activityType === "send") {
        return `-${item.amount} ${item.tokenSymbol}`;
      } else if (activityType === "receive") {
        return `+${item.amount} ${item.tokenSymbol}`;
      } else if (activityType === "swap" && item.toAmount && item.toTokenSymbol) {
        return `+${item.toAmount} ${item.toTokenSymbol}`;
      }
      return `${item.amount} ${item.tokenSymbol}`;
    };

    const amountColor =
      activityType === "receive"
        ? theme.success
        : activityType === "send"
        ? theme.text
        : theme.warning;

    return (
      <Pressable
        style={styles.transactionRow}
        onPress={() => handleTransactionPress(item)}
      >
        <View style={[styles.txIcon, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name={activityIcon} size={18} color={theme.text} />
        </View>
        <View style={styles.txInfo}>
          <View style={styles.txHeader}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {activityLabel}
            </ThemedText>
            {item.status === "confirmed" ? (
              <View style={[styles.statusDot, { backgroundColor: theme.success }]} />
            ) : item.status === "pending" ? (
              <Badge label="Pending" variant="warning" />
            ) : (
              <Badge label="Failed" variant="danger" />
            )}
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {getSubtitle()}
          </ThemedText>
        </View>
        <View style={styles.txAmount}>
          <ThemedText
            type="body"
            style={{
              fontWeight: "600",
              textAlign: "right",
              color: amountColor,
            }}
          >
            {getAmountDisplay()}
          </ThemedText>
          {chain && (
            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "right" }}>
              {chain.name}
            </ThemedText>
          )}
        </View>
      </Pressable>
    );
  };

  const renderSectionHeader = ({ section }: { section: { title: string } }) => (
    <ThemedText type="caption" style={[styles.sectionHeader, { color: theme.textSecondary }]}>
      {section.title}
    </ThemedText>
  );

  if (!activeWallet) {
    return (
      <ThemedView style={styles.container}>
        <EmptyState title="No Wallet" message="Create or import a wallet to see activity" />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: headerHeight + Spacing.md }]}>
        <Pressable
          style={[styles.networkFilter, { backgroundColor: theme.backgroundDefault }]}
          onPress={() => setShowNetworkPicker(!showNetworkPicker)}
        >
          <ThemedText type="caption" style={{ fontWeight: "600" }}>
            {getNetworkName(networkFilter)}
          </ThemedText>
          <Feather name="chevron-down" size={14} color={theme.text} />
        </Pressable>

        {showNetworkPicker ? (
          <View style={[styles.networkDropdown, { backgroundColor: theme.backgroundDefault }]}>
            <Pressable
              style={styles.networkOption}
              onPress={() => {
                setNetworkFilter("all");
                setShowNetworkPicker(false);
              }}
            >
              <ThemedText type="body">All networks</ThemedText>
              {networkFilter === "all" ? (
                <Feather name="check" size={16} color={theme.accent} />
              ) : null}
            </Pressable>
            {supportedChains.map((chain) => (
              <Pressable
                key={chain.chainId}
                style={styles.networkOption}
                onPress={() => {
                  setNetworkFilter(chain.chainId);
                  setShowNetworkPicker(false);
                }}
              >
                <ThemedText type="body">{chain.name}</ThemedText>
                {networkFilter === chain.chainId ? (
                  <Feather name="check" size={16} color={theme.accent} />
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <Pressable
        style={[styles.explorerBanner, { backgroundColor: theme.backgroundDefault }]}
        onPress={handleCheckExplorer}
      >
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Can't find your transaction?{" "}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.accent, fontWeight: "600" }}>
          Check explorer
        </ThemedText>
      </Pressable>

      <SectionList
        style={styles.list}
        contentContainerStyle={{
          paddingBottom: tabBarHeight + Spacing.xl,
          paddingHorizontal: Spacing.lg,
          flexGrow: 1,
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        sections={groupedData}
        keyExtractor={(item) => item.id}
        renderItem={renderTransaction}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              image={require("../../assets/images/empty-activity.png")}
              title="No Activity Yet"
              message="Your sends, receives, and swaps will appear here"
            />
          )
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    zIndex: 10,
  },
  networkFilter: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
  },
  networkDropdown: {
    position: "absolute",
    top: "100%",
    left: Spacing.lg,
    marginTop: Spacing.xs,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    minWidth: 160,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  networkOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  explorerBanner: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  list: {
    flex: 1,
  },
  sectionHeader: {
    paddingVertical: Spacing.md,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  transactionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  txInfo: {
    flex: 1,
    gap: 2,
  },
  txHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  txAmount: {
    alignItems: "flex-end",
    gap: 2,
  },
});
