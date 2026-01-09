import { useState, useCallback, useEffect } from "react";
import { View, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { NetworkBadge, NetworkId } from "@/components/NetworkBadge";
import { EmptyState } from "@/components/EmptyState";
import { useWallet } from "@/lib/wallet-context";
import { usePortfolio, formatTimeSince } from "@/hooks/usePortfolio";
import { getExplorerAddressUrl } from "@/lib/blockchain/chains";
import { NETWORKS } from "@/lib/types";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

function getTokenIcon(symbol: string): keyof typeof Feather.glyphMap {
  const iconMap: Record<string, keyof typeof Feather.glyphMap> = {
    ETH: "hexagon",
    MATIC: "octagon",
    BNB: "circle",
    USDC: "dollar-sign",
    USDT: "dollar-sign",
    DAI: "disc",
    WBTC: "box",
    BTCB: "box",
    WETH: "hexagon",
  };
  return iconMap[symbol] || "disc";
}

export default function PortfolioScreen() {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { activeWallet, selectedNetwork, setSelectedNetwork } = useWallet();
  const [copied, setCopied] = useState(false);

  const { assets, isLoading, isRefreshing, error, lastUpdated, refresh } = usePortfolio(
    activeWallet?.address,
    selectedNetwork
  );

  const networks: NetworkId[] = ["ethereum", "polygon", "bsc"];

  const chainId = NETWORKS[selectedNetwork].chainId;

  const handleViewExplorer = async () => {
    if (activeWallet) {
      const url = getExplorerAddressUrl(chainId, activeWallet.address);
      if (url) {
        await WebBrowser.openBrowserAsync(url);
      }
    }
  };

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

  useEffect(() => {
    if (!activeWallet) {
      navigation.reset({
        index: 0,
        routes: [{ name: "Welcome" }],
      });
    }
  }, [activeWallet, navigation]);

  if (!activeWallet) {
    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
        <ActivityIndicator size="large" color={theme.accent} />
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
        <RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={theme.accent} />
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
          <Pressable onPress={handleViewExplorer} style={styles.explorerButton}>
            <Feather name="external-link" size={16} color={theme.accent} />
          </Pressable>
        </Pressable>

        {lastUpdated ? (
          <ThemedText type="caption" style={[styles.lastUpdated, { color: theme.textSecondary }]}>
            Updated {formatTimeSince(lastUpdated)}
          </ThemedText>
        ) : null}

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

        {error ? (
          <View style={[styles.errorBanner, { backgroundColor: theme.danger + "20" }]}>
            <Feather name="alert-circle" size={16} color={theme.danger} />
            <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>
              {error}
            </ThemedText>
            <Pressable onPress={refresh}>
              <ThemedText type="small" style={{ color: theme.accent }}>Retry</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <View style={[styles.skeletonRow, { backgroundColor: theme.backgroundDefault }]}>
              <View style={[styles.skeletonIcon, { backgroundColor: theme.backgroundSecondary }]} />
              <View style={styles.skeletonInfo}>
                <View style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 80 }]} />
                <View style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 120 }]} />
              </View>
            </View>
            <View style={[styles.skeletonRow, { backgroundColor: theme.backgroundDefault }]}>
              <View style={[styles.skeletonIcon, { backgroundColor: theme.backgroundSecondary }]} />
              <View style={styles.skeletonInfo}>
                <View style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 60 }]} />
                <View style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 100 }]} />
              </View>
            </View>
          </View>
        ) : assets.length === 0 && !error ? (
          <View style={[styles.emptyAssets, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="inbox" size={32} color={theme.textSecondary} />
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              No assets found
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
              This wallet has no tokens on {NETWORKS[selectedNetwork].name}
            </ThemedText>
          </View>
        ) : assets.length > 0 ? (
          assets.map((asset) => (
            <Pressable
              key={asset.isNative ? "native" : asset.address}
              style={[styles.tokenRow, { backgroundColor: theme.backgroundDefault }]}
              onPress={() => navigation.navigate("AssetDetail", { tokenSymbol: asset.symbol, balance: asset.balance })}
            >
              <View style={[styles.tokenIcon, { backgroundColor: theme.accent + "15" }]}>
                <Feather name={getTokenIcon(asset.symbol)} size={20} color={theme.accent} />
              </View>
              <View style={styles.tokenInfo}>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  {asset.symbol}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {asset.name}
                </ThemedText>
              </View>
              <View style={styles.tokenBalance}>
                <ThemedText type="body" style={{ fontWeight: "600", textAlign: "right" }}>
                  {asset.balance} {asset.symbol}
                </ThemedText>
              </View>
              <Feather name="chevron-right" size={20} color={theme.textSecondary} />
            </Pressable>
          ))
        ) : null}
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
  explorerButton: {
    padding: Spacing.sm,
  },
  lastUpdated: {
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  loadingContainer: {
    gap: Spacing.md,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  skeletonIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
  },
  skeletonInfo: {
    flex: 1,
    gap: Spacing.sm,
  },
  skeletonText: {
    height: 14,
    borderRadius: BorderRadius.xs,
  },
  emptyAssets: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
});
