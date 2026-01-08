import { useState, useCallback } from "react";
import { View, StyleSheet, FlatList, Pressable, RefreshControl, Image } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { useWallet } from "@/lib/wallet-context";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

interface MockTransaction {
  id: string;
  type: "send" | "receive" | "approve" | "swap";
  status: "success" | "pending" | "failed";
  tokenSymbol: string;
  amount: string;
  address: string;
  timestamp: string;
  hash: string;
}

const MOCK_TRANSACTIONS: MockTransaction[] = [
  { id: "1", type: "receive", status: "success", tokenSymbol: "ETH", amount: "+0.5", address: "0x1234...5678", timestamp: "2 hours ago", hash: "0xabc...123" },
  { id: "2", type: "send", status: "success", tokenSymbol: "USDC", amount: "-250.00", address: "0x8765...4321", timestamp: "5 hours ago", hash: "0xdef...456" },
  { id: "3", type: "approve", status: "success", tokenSymbol: "USDC", amount: "Unlimited", address: "Uniswap V3", timestamp: "1 day ago", hash: "0xghi...789" },
  { id: "4", type: "swap", status: "success", tokenSymbol: "ETH", amount: "0.1 -> 180 USDC", address: "Uniswap", timestamp: "2 days ago", hash: "0xjkl...012" },
  { id: "5", type: "send", status: "pending", tokenSymbol: "MATIC", amount: "-100.00", address: "0x9999...1111", timestamp: "Just now", hash: "0xmno...345" },
];

export default function ActivityScreen() {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { activeWallet } = useWallet();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const getTransactionIcon = (type: MockTransaction["type"]) => {
    switch (type) {
      case "send":
        return "arrow-up-right";
      case "receive":
        return "arrow-down-left";
      case "approve":
        return "check-circle";
      case "swap":
        return "repeat";
    }
  };

  const getTransactionColor = (type: MockTransaction["type"]) => {
    switch (type) {
      case "send":
        return theme.danger;
      case "receive":
        return theme.success;
      case "approve":
        return theme.warning;
      case "swap":
        return theme.accent;
    }
  };

  const getStatusBadge = (status: MockTransaction["status"]) => {
    switch (status) {
      case "success":
        return <Badge label="Success" variant="success" />;
      case "pending":
        return <Badge label="Pending" variant="warning" />;
      case "failed":
        return <Badge label="Failed" variant="danger" />;
    }
  };

  const renderTransaction = ({ item }: { item: MockTransaction }) => {
    const iconColor = getTransactionColor(item.type);
    
    return (
      <Pressable
        style={[styles.transactionRow, { backgroundColor: theme.backgroundDefault }]}
        onPress={() => navigation.navigate("TransactionDetail", { txHash: item.hash })}
      >
        <View style={[styles.txIcon, { backgroundColor: iconColor + "20" }]}>
          <Feather name={getTransactionIcon(item.type)} size={20} color={iconColor} />
        </View>
        <View style={styles.txInfo}>
          <View style={styles.txHeader}>
            <ThemedText type="body" style={{ fontWeight: "600", textTransform: "capitalize" }}>
              {item.type}
            </ThemedText>
            {getStatusBadge(item.status)}
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {item.address}
          </ThemedText>
        </View>
        <View style={styles.txAmount}>
          <ThemedText 
            type="body" 
            style={{ 
              fontWeight: "600", 
              textAlign: "right",
              color: item.type === "receive" ? theme.success : theme.text,
            }}
          >
            {item.amount} {item.type !== "swap" && item.type !== "approve" ? item.tokenSymbol : ""}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "right" }}>
            {item.timestamp}
          </ThemedText>
        </View>
        <Feather name="chevron-right" size={20} color={theme.textSecondary} />
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
      data={MOCK_TRANSACTIONS}
      keyExtractor={(item) => item.id}
      renderItem={renderTransaction}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
      }
      ListEmptyComponent={
        <EmptyState
          image={require("../../assets/images/empty-activity.png")}
          title="No Activity Yet"
          message="Your transaction history will appear here"
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
