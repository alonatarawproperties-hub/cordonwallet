import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { View, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Image } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { useSharedValue, useAnimatedStyle, withSpring, interpolate } from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { useWallet } from "@/lib/wallet-context";
import { useAllChainsPortfolio, MultiChainAsset } from "@/hooks/useAllChainsPortfolio";
import { useSolanaPortfolio, SolanaAsset } from "@/hooks/useSolanaPortfolio";
import { formatTimeSince } from "@/hooks/usePortfolio";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { getTokenLogoUrl } from "@/lib/token-logos";
import type { ChainType } from "@/components/ChainSelector";
import { getCustomTokens, getHiddenTokens, CustomToken, buildCustomTokenMap } from "@/lib/token-preferences";
import { savePortfolioDisplayCache } from "@/lib/portfolio-cache";
import { AnimatedRefreshIndicator } from "@/components/AnimatedRefreshIndicator";
import { TokenSecurityBadge } from "@/components/TokenSecurityBadge";
import { TokenSecurityModal } from "@/components/TokenSecurityModal";
import { analyzeTokenSecurity, TokenSecurityAssessment, RiskLevel } from "@/lib/token-security";
import { Connection } from "@solana/web3.js";
import { RPC_PRIMARY } from "@/constants/solanaSwap";

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

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function ActionButton({
  icon,
  label,
  iconColor,
  onPress,
  disabled,
  theme,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  iconColor: string;
  onPress: () => void;
  disabled?: boolean;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: interpolate(scale.value, [0.96, 1], [0.9, disabled ? 0.5 : 1]),
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.96, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  return (
    <AnimatedPressable
      style={[styles.actionButton, { backgroundColor: theme.backgroundSecondary }, animatedStyle]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
    >
      <View style={[styles.actionIcon, { backgroundColor: iconColor + "20" }]}>
        <Feather name={icon} size={18} color={iconColor} />
      </View>
      <ThemedText type="small" style={styles.actionLabel}>{label}</ThemedText>
    </AnimatedPressable>
  );
}

function AssetRow({
  asset,
  theme,
  onPress,
  securityRisk,
  onSecurityPress,
}: {
  asset: UnifiedAsset;
  theme: ReturnType<typeof useTheme>["theme"];
  onPress: () => void;
  securityRisk?: RiskLevel;
  onSecurityPress?: () => void;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  return (
    <AnimatedPressable
      style={[styles.tokenRow, { backgroundColor: theme.backgroundDefault }, animatedStyle]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <View style={[styles.tokenIcon, { backgroundColor: getChainColor(asset.chainName) + "12" }]}>
        {("logoUrl" in asset && asset.logoUrl) || getTokenLogoUrl(asset.symbol) ? (
          <Image 
            source={{ uri: ("logoUrl" in asset && asset.logoUrl) ? asset.logoUrl : getTokenLogoUrl(asset.symbol)! }} 
            style={styles.tokenLogoImage}
          />
        ) : (
          <Feather name={getTokenIcon(asset.symbol)} size={18} color={getChainColor(asset.chainName)} />
        )}
      </View>
      <View style={styles.tokenInfo}>
        <View style={styles.tokenHeader}>
          <ThemedText type="body" style={styles.tokenSymbol}>
            {asset.symbol}
          </ThemedText>
          <View style={[styles.chainBadge, { backgroundColor: getChainColor(asset.chainName) + "15" }]}>
            <ThemedText type="caption" style={[styles.chainBadgeText, { color: getChainColor(asset.chainName) }]}>
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
              style={[styles.priceChange, { color: asset.priceChange24h >= 0 ? "#22C55E" : "#EF4444" }]}
            >
              {asset.priceChange24h >= 0 ? "+" : ""}{asset.priceChange24h.toFixed(2)}%
            </ThemedText>
          ) : null}
        </View>
      </View>
      <View style={styles.tokenBalance}>
        <ThemedText type="body" style={styles.balanceAmount}>
          {asset.balance}
        </ThemedText>
        {asset.valueUsd ? (
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {formatValue(asset.valueUsd)}
          </ThemedText>
        ) : null}
      </View>
      {securityRisk && onSecurityPress ? (
        <TokenSecurityBadge 
          riskLevel={securityRisk} 
          onPress={onSecurityPress}
          size="small"
        />
      ) : null}
      <Feather name="chevron-right" size={18} color={theme.textSecondary} style={{ opacity: 0.6 }} />
    </AnimatedPressable>
  );
}

export default function PortfolioScreen() {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { activeWallet } = useWallet();
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);
  const [hiddenTokens, setHiddenTokens] = useState<string[]>([]);
  const stableAssetsRef = useRef<UnifiedAsset[]>([]);
  const [securityAssessments, setSecurityAssessments] = useState<Map<string, TokenSecurityAssessment>>(new Map());
  const [selectedSecurityAsset, setSelectedSecurityAsset] = useState<{ assessment: TokenSecurityAssessment; name: string; symbol: string } | null>(null);
  const [securityModalVisible, setSecurityModalVisible] = useState(false);

  const walletType = activeWallet?.walletType || "multi-chain";
  const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address;
  const solanaAddress = activeWallet?.addresses?.solana;

  const evmPortfolio = useAllChainsPortfolio(walletType === "solana-only" ? undefined : evmAddress);
  const solanaPortfolio = useSolanaPortfolio(solanaAddress);
  
  useFocusEffect(
    useCallback(() => {
      getCustomTokens().then(setCustomTokens);
      getHiddenTokens().then(setHiddenTokens);
    }, [])
  );
  
  const customTokenMap = buildCustomTokenMap(customTokens);

  const { assets, isLoading, isRefreshing, error, lastUpdated, totalValue } = useMemo(() => {
    const evmAssets: UnifiedAsset[] = walletType === "solana-only" ? [] : evmPortfolio.assets.map((a) => ({
      ...a,
      chainType: "evm" as ChainType,
    }));
    
    const solAssets: UnifiedAsset[] = solanaPortfolio.assets.map((a) => {
      const customToken = a.mint ? customTokenMap.get(a.mint.toLowerCase()) : undefined;
      return {
        ...a,
        symbol: customToken?.symbol || a.symbol,
        name: customToken?.name || a.name,
        logoUrl: customToken?.logoUrl || a.logoUrl,
        chainId: 0,
        chainType: "solana" as ChainType,
      };
    });

    const isRefreshingAny = (walletType === "solana-only" ? false : evmPortfolio.isRefreshing) || solanaPortfolio.isRefreshing;
    const isLoadingAny = (walletType === "solana-only" ? false : evmPortfolio.isLoading) || solanaPortfolio.isLoading;

    const combined = [...evmAssets, ...solAssets];
    
    let allAssets: UnifiedAsset[];
    if (isRefreshingAny && stableAssetsRef.current.length > 0) {
      const prevOrder = new Map(stableAssetsRef.current.map((a, i) => [
        `${a.chainType}_${a.symbol}_${a.chainId}`, i
      ]));
      allAssets = combined.map((asset) => {
        const key = `${asset.chainType}_${asset.symbol}_${asset.chainId}`;
        const prevAsset = stableAssetsRef.current.find(
          (a) => `${a.chainType}_${a.symbol}_${a.chainId}` === key
        );
        return prevAsset ? { ...asset, valueUsd: prevAsset.valueUsd || asset.valueUsd } : asset;
      }).sort((a, b) => {
        const keyA = `${a.chainType}_${a.symbol}_${a.chainId}`;
        const keyB = `${b.chainType}_${b.symbol}_${b.chainId}`;
        const orderA = prevOrder.get(keyA) ?? 999;
        const orderB = prevOrder.get(keyB) ?? 999;
        return orderA - orderB;
      });
    } else {
      allAssets = combined.sort((a, b) => {
        const valueDiff = (b.valueUsd || 0) - (a.valueUsd || 0);
        if (valueDiff !== 0) return valueDiff;
        if (a.isNative && !b.isNative) return -1;
        if (!a.isNative && b.isNative) return 1;
        return a.symbol.localeCompare(b.symbol);
      });
      if (!isLoadingAny) {
        stableAssetsRef.current = allAssets;
      }
    }

    // Filter out hidden tokens and zero-balance assets
    const visibleAssets = allAssets.filter(asset => {
      // Check if token is hidden
      const tokenKey = `${asset.chainId}:${asset.symbol}`;
      if (hiddenTokens.includes(tokenKey)) return false;
      
      // Hide zero-balance assets by default on homepage
      const balance = parseFloat(asset.balance || "0");
      return balance > 0;
    });

    const total = visibleAssets.reduce((sum, asset) => sum + (asset.valueUsd || 0), 0);
    const errorAny = (walletType === "solana-only" ? null : evmPortfolio.error) || solanaPortfolio.error;
    const latestUpdate = Math.max(
      walletType === "solana-only" ? 0 : (evmPortfolio.lastUpdated || 0), 
      solanaPortfolio.lastUpdated || 0
    );

    return {
      assets: visibleAssets,
      isLoading: isLoadingAny,
      isRefreshing: isRefreshingAny,
      error: errorAny,
      lastUpdated: latestUpdate > 0 ? latestUpdate : null,
      totalValue: total,
    };
  }, [evmPortfolio, solanaPortfolio, walletType, customTokenMap, hiddenTokens]);

  const handleRefresh = () => {
    evmPortfolio.refresh();
    solanaPortfolio.refresh();
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
      logoUrl: "logoUrl" in asset ? asset.logoUrl : undefined,
    });
  };

  const [activeTab, setActiveTab] = useState<"assets" | "approvals">("assets");
  const hasTriggeredRefresh = useRef(false);

  const handleRefreshWithHaptic = useCallback(() => {
    if (!hasTriggeredRefresh.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      hasTriggeredRefresh.current = true;
    }
    handleRefresh();
  }, []);

  useEffect(() => {
    if (!isRefreshing) {
      hasTriggeredRefresh.current = false;
    }
  }, [isRefreshing]);

  useEffect(() => {
    if (!isLoading && !isRefreshing && lastUpdated && (evmPortfolio.assets.length > 0 || solanaPortfolio.assets.length > 0)) {
      savePortfolioDisplayCache(
        evmPortfolio.assets,
        solanaPortfolio.assets,
        evmAddress,
        solanaAddress
      );
    }
  }, [lastUpdated, isLoading, isRefreshing, evmPortfolio.assets, solanaPortfolio.assets, evmAddress, solanaAddress]);

  useEffect(() => {
    const analyzeSolanaTokens = async () => {
      const solanaAssets = assets.filter(a => a.chainType === "solana" && "mint" in a && a.mint);
      if (solanaAssets.length === 0) return;

      try {
        const connection = new Connection(RPC_PRIMARY, { commitment: "confirmed" });
        const newAssessments = new Map(securityAssessments);
        
        for (const asset of solanaAssets) {
          const mint = (asset as any).mint as string;
          if (!mint || newAssessments.has(mint)) continue;
          
          try {
            const assessment = await analyzeTokenSecurity(connection, mint);
            newAssessments.set(mint, assessment);
          } catch (e) {
            console.warn(`Failed to analyze ${asset.symbol}:`, e);
          }
        }
        
        if (newAssessments.size > securityAssessments.size) {
          setSecurityAssessments(newAssessments);
        }
      } catch (e) {
        console.warn("Security analysis failed:", e);
      }
    };

    if (!isLoading && assets.length > 0) {
      analyzeSolanaTokens();
    }
  }, [assets, isLoading]);

  const handleSecurityPress = useCallback((asset: UnifiedAsset) => {
    if (asset.chainType !== "solana" || !("mint" in asset)) return;
    const mint = (asset as any).mint as string;
    const assessment = securityAssessments.get(mint);
    if (assessment) {
      setSelectedSecurityAsset({
        assessment,
        name: asset.name,
        symbol: asset.symbol,
      });
      setSecurityModalVisible(true);
    }
  }, [securityAssessments]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.md,
        paddingBottom: tabBarHeight + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      refreshControl={
        <RefreshControl 
          refreshing={isRefreshing} 
          onRefresh={handleRefreshWithHaptic} 
          tintColor="transparent"
          colors={["transparent"]}
          progressBackgroundColor="transparent"
          progressViewOffset={headerHeight}
        />
      }
    >
      <AnimatedRefreshIndicator 
        isRefreshing={isRefreshing} 
        color={theme.accent}
        size={24}
      />
      <View style={[styles.balanceCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.totalValueContainer}>
          <ThemedText type="h1" style={styles.totalValue}>
            ${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </ThemedText>
          {lastUpdated ? (
            <ThemedText type="caption" style={[styles.lastUpdated, { color: theme.textSecondary }]}>
              Updated {formatTimeSince(lastUpdated)}
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.actionButtons}>
          <ActionButton
            icon="arrow-up-right"
            label="Send"
            iconColor={theme.accent}
            onPress={() => navigation.navigate("Send", {})}
            theme={theme}
          />
          <ActionButton
            icon="arrow-down-left"
            label="Receive"
            iconColor={theme.success}
            onPress={() => navigation.navigate("Receive", { 
              walletAddress: evmAddress || activeWallet.address,
              solanaAddress: activeWallet.addresses?.solana,
            })}
            theme={theme}
          />
          <ActionButton
            icon="repeat"
            label="Swap"
            iconColor={theme.warning}
            onPress={() => (navigation as any).navigate("Swap")}
            theme={theme}
          />
        </View>
      </View>

      <View style={styles.assetsSection}>
        <View style={[styles.tabsContainer, { backgroundColor: theme.backgroundSecondary }]}>
          <Pressable
            style={[
              styles.tab,
              activeTab === "assets" && { backgroundColor: theme.backgroundDefault },
            ]}
            onPress={() => setActiveTab("assets")}
          >
            <ThemedText 
              type="small" 
              style={[styles.tabText, activeTab === "assets" && { fontWeight: "600" }]}
            >
              Assets
            </ThemedText>
          </Pressable>
          <Pressable
            style={[
              styles.tab,
              activeTab === "approvals" && { backgroundColor: theme.backgroundDefault },
            ]}
            onPress={() => {
              setActiveTab("approvals");
              navigation.navigate("Approvals");
            }}
          >
            <Feather name="shield" size={12} color={activeTab === "approvals" ? theme.text : theme.textSecondary} style={{ marginRight: 4 }} />
            <ThemedText 
              type="small" 
              style={[styles.tabText, activeTab === "approvals" && { fontWeight: "600" }]}
            >
              Security
            </ThemedText>
          </Pressable>
        </View>

        {error ? (
          <View style={[styles.errorBanner, { backgroundColor: theme.danger + "15" }]}>
            <Feather name="alert-circle" size={14} color={theme.danger} />
            <ThemedText type="caption" style={{ color: theme.danger, flex: 1 }}>
              {error}
            </ThemedText>
            <Pressable onPress={handleRefresh} hitSlop={8}>
              <ThemedText type="caption" style={{ color: theme.accent, fontWeight: "500" }}>
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
                  <View style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 70 }]} />
                  <View style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 100 }]} />
                </View>
                <View style={styles.skeletonBalance}>
                  <View style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 50 }]} />
                  <View style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 40 }]} />
                </View>
              </View>
            ))}
          </View>
        ) : assets.length === 0 && !error ? (
          <View style={[styles.emptyAssets, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="inbox" size={28} color={theme.textSecondary} />
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              No assets found
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
              This wallet has no tokens on any supported network
            </ThemedText>
          </View>
        ) : assets.length > 0 ? (
          assets.map((asset, index) => {
            const mint = asset.chainType === "solana" && "mint" in asset ? (asset as any).mint as string : undefined;
            const assessment = mint ? securityAssessments.get(mint) : undefined;
            return (
              <AssetRow
                key={`${asset.chainType}-${asset.chainId}-${asset.isNative ? "native" : ("address" in asset ? asset.address : ("mint" in asset ? asset.mint : ""))}-${index}`}
                asset={asset}
                theme={theme}
                onPress={() => handleAssetPress(asset)}
                securityRisk={assessment?.overallRisk}
                onSecurityPress={() => handleSecurityPress(asset)}
              />
            );
          })
        ) : null}

        <Pressable
          style={styles.manageCryptoButton}
          onPress={() => navigation.navigate("ManageCrypto")}
        >
          <ThemedText type="small" style={{ color: theme.accent }}>
            Manage crypto
          </ThemedText>
        </Pressable>
      </View>

      <TokenSecurityModal
        visible={securityModalVisible}
        onClose={() => setSecurityModalVisible(false)}
        assessment={selectedSecurityAsset?.assessment || null}
        tokenName={selectedSecurityAsset?.name}
        tokenSymbol={selectedSecurityAsset?.symbol}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  balanceCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.lg,
  },
  totalValueContainer: {
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  totalValue: {
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  lastUpdated: {
    marginTop: Spacing.xs,
    fontSize: 11,
    opacity: 0.6,
  },
  actionButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  actionButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
    minHeight: 48,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  assetsSection: {
    gap: Spacing.sm,
  },
  tabsContainer: {
    flexDirection: "row",
    padding: 3,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tabText: {
    fontSize: 13,
  },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
    marginBottom: 2,
  },
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tokenLogoImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  tokenInfo: {
    flex: 1,
    gap: 2,
  },
  tokenHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  tokenSymbol: {
    fontWeight: "600",
    fontSize: 15,
  },
  chainBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  chainBadgeText: {
    fontSize: 9,
    fontWeight: "500",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  priceChange: {
    marginLeft: Spacing.xs,
    fontSize: 11,
  },
  tokenBalance: {
    alignItems: "flex-end",
    gap: 2,
  },
  balanceAmount: {
    fontWeight: "600",
    fontSize: 15,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
  },
  loadingContainer: {
    gap: Spacing.xs,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  skeletonIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
  },
  skeletonInfo: {
    flex: 1,
    gap: Spacing.sm,
  },
  skeletonBalance: {
    alignItems: "flex-end",
    gap: Spacing.xs,
  },
  skeletonText: {
    height: 12,
    borderRadius: 4,
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
    paddingVertical: Spacing.md,
    marginTop: Spacing.xs,
  },
});
