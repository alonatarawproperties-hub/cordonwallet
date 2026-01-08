import { useState, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable, RefreshControl, Image } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { NetworkBadge, NetworkId } from "@/components/NetworkBadge";
import { IconButton } from "@/components/IconButton";
import { EmptyState } from "@/components/EmptyState";
import { useWallet } from "@/lib/wallet-context";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

const MOCK_TOKENS = [
  { symbol: "ETH", name: "Ethereum", balance: "2.5421", balanceUsd: "$4,523.12", icon: "circle" },
  { symbol: "USDC", name: "USD Coin", balance: "1,250.00", balanceUsd: "$1,250.00", icon: "dollar-sign" },
  { symbol: "MATIC", name: "Polygon", balance: "5,421.32", balanceUsd: "$3,252.79", icon: "hexagon" },
];

export default function PortfolioScreen() {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { activeWallet, selectedNetwork, setSelectedNetwork } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  const networks: NetworkId[] = ["ethereum", "polygon", "bsc"];

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const handleCopyAddress = async () => {
    if (activeWallet) {
      await Clipboard.setStringAsync(activeWallet.address);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  if (!activeWallet) {
    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
        <EmptyState
          image={require("../../assets/images/empty-wallet.png")}
          title="No Wallet"
          message="Create or import a wallet to get started"
          actionLabel="Add Wallet"
          onAction={() => navigation.navigate("WalletManager")}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.lg,
        paddingBottom: tabBarHeight + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
      }
    >
      <View style={[styles.balanceCard, { backgroundColor: theme.backgroundDefault }]}>
        <Pressable style={styles.walletSelector} onPress={() => navigation.navigate("WalletManager")}>
          <View style={[styles.walletIcon, { backgroundColor: theme.accent + "20" }]}>
            <Feather name="user" size={16} color={theme.accent} />
          </View>
          <View style={styles.walletInfo}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              {activeWallet.name}
            </ThemedText>
            <Pressable onPress={handleCopyAddress} style={styles.addressRow}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {truncateAddress(activeWallet.address)}
              </ThemedText>
              <Feather name={copied ? "check" : "copy"} size={12} color={theme.accent} />
            </Pressable>
          </View>
          <Feather name="chevron-down" size={20} color={theme.textSecondary} />
        </Pressable>

        <ThemedText type="h1" style={styles.totalBalance}>
          $9,025.91
        </ThemedText>
        <ThemedText type="small" style={[styles.changeText, { color: theme.success }]}>
          +$245.32 (2.79%) today
        </ThemedText>

        <View style={styles.actionButtons}>
          <Pressable 
            style={[styles.actionButton, { backgroundColor: theme.backgroundSecondary }]}
            onPress={() => navigation.navigate("Send", {})}
          >
            <View style={[styles.actionIcon, { backgroundColor: theme.accent + "20" }]}>
              <Feather name="arrow-up-right" size={20} color={theme.accent} />
            </View>
            <ThemedText type="small">Send</ThemedText>
          </Pressable>

          <Pressable 
            style={[styles.actionButton, { backgroundColor: theme.backgroundSecondary }]}
            onPress={() => navigation.navigate("Receive", { walletAddress: activeWallet.address })}
          >
            <View style={[styles.actionIcon, { backgroundColor: theme.success + "20" }]}>
              <Feather name="arrow-down-left" size={20} color={theme.success} />
            </View>
            <ThemedText type="small">Receive</ThemedText>
          </Pressable>

          <Pressable 
            style={[styles.actionButton, { backgroundColor: theme.backgroundSecondary }]}
            onPress={() => {}}
          >
            <View style={[styles.actionIcon, { backgroundColor: theme.warning + "20" }]}>
              <Feather name="repeat" size={20} color={theme.warning} />
            </View>
            <ThemedText type="small">Swap</ThemedText>
          </Pressable>
        </View>
      </View>

      <View style={styles.networkSection}>
        <ThemedText type="small" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
          Network
        </ThemedText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.networkScroll}>
          <View style={styles.networkRow}>
            {networks.map((network) => (
              <NetworkBadge
                key={network}
                networkId={network}
                selected={selectedNetwork === network}
                onPress={() => setSelectedNetwork(network)}
              />
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={styles.assetsSection}>
        <View style={styles.sectionHeader}>
          <ThemedText type="h4">Assets</ThemedText>
          <Pressable onPress={() => navigation.navigate("Approvals")}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              Approvals
            </ThemedText>
          </Pressable>
        </View>

        {MOCK_TOKENS.map((token, index) => (
          <Pressable
            key={token.symbol}
            style={[styles.tokenRow, { backgroundColor: theme.backgroundDefault }]}
            onPress={() => navigation.navigate("AssetDetail", { tokenSymbol: token.symbol, balance: token.balance })}
          >
            <View style={[styles.tokenIcon, { backgroundColor: theme.accent + "15" }]}>
              <Feather name={token.icon as any} size={20} color={theme.accent} />
            </View>
            <View style={styles.tokenInfo}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {token.symbol}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {token.name}
              </ThemedText>
            </View>
            <View style={styles.tokenBalance}>
              <ThemedText type="body" style={{ fontWeight: "600", textAlign: "right" }}>
                {token.balanceUsd}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "right" }}>
                {token.balance} {token.symbol}
              </ThemedText>
            </View>
            <Feather name="chevron-right" size={20} color={theme.textSecondary} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  balanceCard: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.xl,
  },
  walletSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  walletIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  walletInfo: {
    flex: 1,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  totalBalance: {
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  changeText: {
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "space-around",
    gap: Spacing.md,
  },
  actionButton: {
    flex: 1,
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  networkSection: {
    marginBottom: Spacing.xl,
  },
  sectionLabel: {
    marginBottom: Spacing.sm,
  },
  networkScroll: {
    marginHorizontal: -Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  networkRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  assetsSection: {
    gap: Spacing.md,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
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
  tokenBalance: {
    gap: Spacing.xs,
  },
});
