import { useState, useCallback, useEffect } from "react";
import { View, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { useWallet } from "@/lib/wallet-context";
import {
  getTransactionsByWallet,
  TxRecord,
  ActivityType,
  formatTransactionDate,
  pollPendingTransactions,
} from "@/lib/transaction-history";

export default function ActivityScreen() {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { activeWallet } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [transactions, setTransactions] = useState<TxRecord[]>([]);

  const loadTransactions = useCallback(async (checkReceipts = false) => {
    if (!activeWallet) {
      setTransactions([]);
      return;
    }

    try {
      if (checkReceipts) {
        await pollPendingTransactions();
      }
      const txs = await getTransactionsByWallet(activeWallet.address);
      setTransactions(txs);
    } catch (error) {
      console.error("Failed to load transactions:", error);
    }
  }, [activeWallet]);

  useFocusEffect(
    useCallback(() => {
      loadTransactions();
    }, [loadTransactions])
  );

  useEffect(() => {
    const hasPending = transactions.some((tx) => tx.status === "pending");
    if (!hasPending) return;

    const interval = setInterval(async () => {
      await loadTransactions(true);
    }, 10000);

    return () => clearInterval(interval);
  }, [transactions, loadTransactions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTransactions(true);
    setRefreshing(false);
  }, [loadTransactions]);

  const getActivityIcon = (activityType: ActivityType): keyof typeof Feather.glyphMap => {
    switch (activityType) {
      case "send":
        return "arrow-up-right";
      case "receive":
        return "arrow-down-left";
      case "swap":
        return "repeat";
    }
  };

  const getActivityColor = (activityType: ActivityType) => {
    switch (activityType) {
      case "send":
        return theme.danger;
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

  const getStatusBadge = (status: TxRecord["status"]) => {
    switch (status) {
      case "confirmed":
        return <Badge label="Confirmed" variant="success" />;
      case "pending":
        return <Badge label="Pending" variant="warning" />;
      case "failed":
        return <Badge label="Failed" variant="danger" />;
    }
  };

  const handleViewExplorer = async (explorerUrl: string) => {
    await WebBrowser.openBrowserAsync(explorerUrl);
  };

  const renderTransaction = ({ item }: { item: TxRecord }) => {
    const activityType = item.activityType || "send";
    const activityColor = getActivityColor(activityType);
    const activityIcon = getActivityIcon(activityType);
    const activityLabel = getActivityLabel(activityType);
    
    const getSubtitle = () => {
      if (activityType === "send") {
        const truncatedTo = `${item.to.slice(0, 6)}...${item.to.slice(-4)}`;
        return `To: ${truncatedTo}`;
      } else if (activityType === "receive" && item.from) {
        const truncatedFrom = `${item.from.slice(0, 6)}...${item.from.slice(-4)}`;
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
    
    return (
      <Pressable
        style={[styles.transactionRow, { backgroundColor: theme.backgroundDefault }]}
        onPress={() => handleViewExplorer(item.explorerUrl)}
      >
        <View style={[styles.txIcon, { backgroundColor: activityColor + "20" }]}>
          <Feather name={activityIcon} size={20} color={activityColor} />
        </View>
        <View style={styles.txInfo}>
          <View style={styles.txHeader}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {activityLabel}
            </ThemedText>
            {getStatusBadge(item.status)}
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
              color: activityType === "receive" ? theme.success : theme.text,
            }}
          >
            {getAmountDisplay()}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "right" }}>
            {formatTransactionDate(item.createdAt)}
          </ThemedText>
        </View>
        <Feather name="external-link" size={16} color={theme.textSecondary} />
      </Pressable>
    );
  };

  if (!activeWallet) {
    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
        <EmptyState
          title="No Wallet"
          message="Create or import a wallet to see activity"
        />
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.xl,
        paddingBottom: tabBarHeight + Spacing.xl,
        paddingHorizontal: Spacing.lg,
        gap: Spacing.md,
        flexGrow: 1,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      data={transactions}
      keyExtractor={(item) => item.id}
      renderItem={renderTransaction}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
      }
      ListEmptyComponent={
        <EmptyState
          image={require("../../assets/images/empty-activity.png")}
          title="No Activity Yet"
          message="Your sends, receives, and swaps will appear here"
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  transactionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  txIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  txInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  txHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  txAmount: {
    gap: Spacing.xs,
  },
});
