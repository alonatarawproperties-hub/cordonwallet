import { useState, useEffect, useMemo } from "react";
import { View, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Image } from "react-native";
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
import { useWallet } from "@/lib/wallet-context";
import { useAllChainsPortfolio, MultiChainAsset } from "@/hooks/useAllChainsPortfolio";
import { useSolanaPortfolio, SolanaAsset } from "@/hooks/useSolanaPortfolio";
import { formatTimeSince } from "@/hooks/usePortfolio";
import { getExplorerAddressUrl } from "@/lib/blockchain/chains";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { getTokenLogoUrl } from "@/lib/token-logos";
import type { ChainType } from "@/components/ChainSelector";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

function getTokenIcon(symbol: string): keyof typeof Feather.glyphMap {
  const iconMap: Record<string, keyof typeof Feather.glyphMap> = {
    ETH: "hexagon",
    MATIC: "octagon",
    POL: "octagon",
    BNB: "circle",
    USDC: "dollar-sign",
    USDT: "dollar-sign",
    DAI: "disc",
    WBTC: "box",
    BTCB: "box",
    WETH: "hexagon",
    SOL: "sun",
  };
  return iconMap[symbol] || "disc";
}

function getChainColor(chainName: string): string {
  const colorMap: Record<string, string> = {
    Ethereum: "#627EEA",
    Polygon: "#8247E5",
    "BNB Chain": "#F3BA2F",
    Solana: "#9945FF",
  };
  return colorMap[chainName] || "#888";
}

function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (price >= 1) {
    return price.toFixed(2);
  } else if (price >= 0.01) {
    return price.toFixed(4);
  } else {
    return price.toFixed(6);
  }
}

function formatValue(value: number): string {
  if (value < 0.01) return "<$0.01";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type UnifiedAsset = (MultiChainAsset | SolanaAsset) & { chainType: ChainType };

export default function PortfolioScreen() {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { activeWallet } = useWallet();
  const [copiedAddress, setCopiedAddress] = useState<"evm" | "solana" | null>(null);

  const walletType = activeWallet?.walletType || "multi-chain";
  const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address;
  const solanaAddress = activeWallet?.addresses?.solana;

  const evmPortfolio = useAllChainsPortfolio(walletType === "solana-only" ? undefined : evmAddress);
  const solanaPortfolio = useSolanaPortfolio(solanaAddress);

  const { assets, isLoading, isRefreshing, error, lastUpdated, totalValue } = useMemo(() => {
    const evmAssets: UnifiedAsset[] = walletType === "solana-only" ? [] : evmPortfolio.assets.map((a) => ({
      ...a,
      chainType: "evm" as ChainType,
    }));
    
    const solAssets: UnifiedAsset[] = solanaPortfolio.assets.map((a) => ({
      ...a,
      chainId: 0,
      chainType: "solana" as ChainType,
    }));

    const allAssets = [...evmAssets, ...solAssets].sort((a, b) => {
      return (b.valueUsd || 0) - (a.valueUsd || 0);
    });

    const total = allAssets.reduce((sum, asset) => sum + (asset.valueUsd || 0), 0);

    const isLoadingAny = (walletType === "solana-only" ? false : evmPortfolio.isLoading) || solanaPortfolio.isLoading;
    const isRefreshingAny = (walletType === "solana-only" ? false : evmPortfolio.isRefreshing) || solanaPortfolio.isRefreshing;
    const errorAny = (walletType === "solana-only" ? null : evmPortfolio.error) || solanaPortfolio.error;
    const latestUpdate = Math.max(
      walletType === "solana-only" ? 0 : (evmPortfolio.lastUpdated || 0), 
      solanaPortfolio.lastUpdated || 0
    );

    return {
      assets: allAssets,
      isLoading: isLoadingAny,
      isRefreshing: isRefreshingAny,
      error: errorAny,
      lastUpdated: latestUpdate > 0 ? latestUpdate : null,
      totalValue: total,
    };
  }, [evmPortfolio, solanaPortfolio, walletType]);

  const handleRefresh = () => {
    evmPortfolio.refresh();
    solanaPortfolio.refresh();
  };

  const handleViewExplorer = async (type: "evm" | "solana") => {
    if (type === "solana" && solanaAddress) {
      const url = `https://solscan.io/account/${solanaAddress}`;
      await WebBrowser.openBrowserAsync(url);
    } else if (type === "evm" && evmAddress) {
      const url = getExplorerAddressUrl(1, evmAddress);
      if (url) {
        await WebBrowser.openBrowserAsync(url);
      }
    }
  };

  const handleCopyAddress = async (type: "evm" | "solana") => {
    const address = type === "solana" ? solanaAddress : evmAddress;
    if (address) {
      await Clipboard.setStringAsync(address);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopiedAddress(type);
      setTimeout(() => setCopiedAddress(null), 2000);
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

  const handleAssetPress = (asset: UnifiedAsset) => {
    navigation.navigate("AssetDetail", {
      tokenSymbol: asset.symbol,
      tokenName: asset.name,
      balance: asset.balance,
      chainId: typeof asset.chainId === "number" ? asset.chainId : 0,
      chainName: asset.chainName,
      isNative: asset.isNative,
      address: "address" in asset ? asset.address : ("mint" in asset ? asset.mint : undefined),
      priceUsd: asset.priceUsd,
      valueUsd: asset.valueUsd,
      priceChange24h: asset.priceChange24h,
      chainType: asset.chainType,
    });
  };

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
        <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={theme.accent} />
      }
    >
      <View style={[styles.balanceCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.totalValueContainer}>
          <ThemedText type="h1" style={styles.totalValue}>
            ${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </ThemedText>
        </View>

        <Pressable style={styles.walletSelector} onPress={() => navigation.navigate("WalletManager")}>
          <View style={[styles.walletIcon, { backgroundColor: theme.accent + "20" }]}>
            <Feather name="user" size={16} color={theme.accent} />
          </View>
          <View style={styles.walletInfo}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              {activeWallet.name}
            </ThemedText>
            <View style={styles.addressesRow}>
              {walletType !== "solana-only" && evmAddress ? (
                <Pressable onPress={() => handleCopyAddress("evm")} style={styles.addressChip}>
                  <View style={[styles.chainDot, { backgroundColor: "#627EEA" }]} />
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {truncateAddress(evmAddress)}
                  </ThemedText>
                  <Feather 
                    name={copiedAddress === "evm" ? "check" : "copy"} 
                    size={10} 
                    color={copiedAddress === "evm" ? theme.success : theme.textSecondary} 
                  />
                </Pressable>
              ) : null}
              {solanaAddress ? (
                <Pressable onPress={() => handleCopyAddress("solana")} style={styles.addressChip}>
                  <View style={[styles.chainDot, { backgroundColor: "#9945FF" }]} />
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {truncateAddress(solanaAddress)}
                  </ThemedText>
                  <Feather 
                    name={copiedAddress === "solana" ? "check" : "copy"} 
                    size={10} 
                    color={copiedAddress === "solana" ? theme.success : theme.textSecondary} 
                  />
                </Pressable>
              ) : null}
            </View>
          </View>
          <Pressable 
            onPress={() => handleViewExplorer(walletType === "solana-only" ? "solana" : "evm")} 
            style={styles.explorerButton}
          >
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
            onPress={() => navigation.navigate("Receive", { walletAddress: evmAddress || activeWallet.address })}
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
            <Pressable onPress={handleRefresh}>
              <ThemedText type="small" style={{ color: theme.accent }}>
                Retry
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.loadingContainer}>
            {[1, 2, 3, 4, 5].map((i) => (
              <View key={i} style={[styles.skeletonRow, { backgroundColor: theme.backgroundDefault }]}>
                <View style={[styles.skeletonIcon, { backgroundColor: theme.backgroundSecondary }]} />
                <View style={styles.skeletonInfo}>
                  <View
                    style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 80 }]}
                  />
                  <View
                    style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 120 }]}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : assets.length === 0 && !error ? (
          <View style={[styles.emptyAssets, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="inbox" size={32} color={theme.textSecondary} />
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              No assets found
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
              This wallet has no tokens on any supported network
            </ThemedText>
          </View>
        ) : assets.length > 0 ? (
          assets.map((asset, index) => (
            <Pressable
              key={`${asset.chainType}-${asset.chainId}-${asset.isNative ? "native" : ("address" in asset ? asset.address : ("mint" in asset ? asset.mint : ""))}-${index}`}
              style={[styles.tokenRow, { backgroundColor: theme.backgroundDefault }]}
              onPress={() => handleAssetPress(asset)}
            >
              <View style={[styles.tokenIcon, { backgroundColor: getChainColor(asset.chainName) + "15" }]}>
                {("logoUrl" in asset && asset.logoUrl) || getTokenLogoUrl(asset.symbol) ? (
                  <Image 
                    source={{ uri: ("logoUrl" in asset && asset.logoUrl) ? asset.logoUrl : getTokenLogoUrl(asset.symbol)! }} 
                    style={styles.tokenLogoImage}
                  />
                ) : (
                  <Feather name={getTokenIcon(asset.symbol)} size={20} color={getChainColor(asset.chainName)} />
                )}
              </View>
              <View style={styles.tokenInfo}>
                <View style={styles.tokenHeader}>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {asset.symbol}
                  </ThemedText>
                  <View
                    style={[styles.chainBadge, { backgroundColor: getChainColor(asset.chainName) + "20" }]}
                  >
                    <ThemedText
                      type="caption"
                      style={{ color: getChainColor(asset.chainName), fontSize: 10 }}
                    >
                      {asset.chainName}
                    </ThemedText>
                  </View>
                </View>
                <View style={styles.priceRow}>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {asset.priceUsd ? `$${formatPrice(asset.priceUsd)}` : asset.name}
                  </ThemedText>
                  {asset.priceChange24h !== undefined ? (
                    <ThemedText
                      type="caption"
                      style={{
                        color: asset.priceChange24h >= 0 ? "#22C55E" : "#EF4444",
                        marginLeft: Spacing.xs,
                      }}
                    >
                      {asset.priceChange24h >= 0 ? "+" : ""}
                      {asset.priceChange24h.toFixed(2)}%
                    </ThemedText>
                  ) : null}
                </View>
              </View>
              <View style={styles.tokenBalance}>
                <ThemedText type="body" style={{ fontWeight: "600", textAlign: "right" }}>
                  {asset.balance}
                </ThemedText>
                {asset.valueUsd ? (
                  <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "right" }}>
                    {formatValue(asset.valueUsd)}
                  </ThemedText>
                ) : null}
              </View>
              <Feather name="chevron-right" size={20} color={theme.textSecondary} />
            </Pressable>
          ))
        ) : null}

        <Pressable
          style={styles.manageCryptoButton}
          onPress={() => navigation.navigate("ManageCrypto")}
        >
          <ThemedText type="body" style={{ color: theme.accent }}>
            Manage crypto
          </ThemedText>
        </Pressable>
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
  totalValueContainer: {
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  totalValue: {
    fontSize: 36,
    fontWeight: "700",
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
    gap: Spacing.xs,
  },
  addressesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  addressChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  chainDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
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
    overflow: "hidden",
  },
  tokenLogoImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  tokenInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  tokenHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  chainBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
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
  manageCryptoButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
  },
});
