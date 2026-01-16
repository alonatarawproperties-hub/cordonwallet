import { useState, useEffect, useCallback } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import {
  SwapRecord,
  getSwapHistory,
  clearSwapHistory,
} from "@/services/swapStore";
import { TxStatus } from "@/services/txBroadcaster";

export default function SwapHistoryScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();

  const [swaps, setSwaps] = useState<SwapRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadSwaps = useCallback(async () => {
    const history = await getSwapHistory();
    setSwaps(history.slice(0, 50));
  }, []);

  useEffect(() => {
    loadSwaps();
  }, [loadSwaps]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadSwaps();
    setRefreshing(false);
  };

  const handleClearHistory = async () => {
    Alert.alert(
      "Clear History",
      "Are you sure you want to clear all swap history?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await clearSwapHistory();
            setSwaps([]);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
  };

  const openExplorer = (signature: string) => {
    const url = `https://solscan.io/tx/${signature}`;
    WebBrowser.openBrowserAsync(url);
  };

  const getStatusIcon = (status: TxStatus) => {
    switch (status) {
      case "confirmed":
      case "finalized":
        return { name: "check-circle" as const, color: "#22C55E" };
      case "failed":
      case "expired":
        return { name: "x-circle" as const, color: "#EF4444" };
      case "submitted":
      case "processed":
        return { name: "clock" as const, color: "#F59E0B" };
      default:
        return { name: "help-circle" as const, color: theme.textSecondary };
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    
    return date.toLocaleDateString();
  };

  const renderSwapItem = ({ item }: { item: SwapRecord }) => {
    const statusIcon = getStatusIcon(item.status);
    
    return (
      <Pressable
        style={[styles.swapItem, { backgroundColor: theme.backgroundSecondary }]}
        onPress={() => item.signature && openExplorer(item.signature)}
      >
        <View style={styles.swapIcon}>
          <Feather name={statusIcon.name} size={24} color={statusIcon.color} />
        </View>
        
        <View style={styles.swapDetails}>
          <View style={styles.swapTokens}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {item.inputAmount} {item.inputSymbol}
            </ThemedText>
            <Feather name="arrow-right" size={14} color={theme.textSecondary} style={{ marginHorizontal: 6 }} />
            <ThemedText type="body" style={{ fontWeight: "600", color: "#22C55E" }}>
              {item.outputAmount} {item.outputSymbol}
            </ThemedText>
          </View>
          
          <View style={styles.swapMeta}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {formatDate(item.timestamp)}
            </ThemedText>
            {item.mode && (
              <View style={[styles.speedBadge, { backgroundColor: theme.backgroundTertiary }]}>
                <ThemedText type="caption" style={{ textTransform: "capitalize" }}>
                  {item.mode}
                </ThemedText>
              </View>
            )}
          </View>
        </View>
        
        <Feather name="external-link" size={16} color={theme.textSecondary} />
      </Pressable>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Feather name="repeat" size={48} color={theme.textSecondary} />
      <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: Spacing.lg }}>
        No swaps yet
      </ThemedText>
      <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: Spacing.sm, textAlign: "center" }}>
        Your swap history will appear here
      </ThemedText>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      {swaps.length > 0 && (
        <View style={[styles.header, { paddingTop: headerHeight }]}>
          <Pressable onPress={handleClearHistory} style={styles.clearButton}>
            <Feather name="trash-2" size={18} color={theme.danger} />
            <ThemedText type="small" style={{ color: theme.danger, marginLeft: 6 }}>
              Clear
            </ThemedText>
          </Pressable>
        </View>
      )}
      
      <FlatList
        data={swaps}
        keyExtractor={(item) => item.id}
        renderItem={renderSwapItem}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingTop: swaps.length === 0 ? headerHeight + Spacing.xl : Spacing.md,
            paddingBottom: insets.bottom + Spacing.xl,
          },
        ]}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} />
        }
        ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  clearButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  swapItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  swapIcon: {
    marginRight: Spacing.md,
  },
  swapDetails: {
    flex: 1,
  },
  swapTokens: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  swapMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: Spacing.xs,
    gap: Spacing.sm,
  },
  speedBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["5xl"],
  },
});
