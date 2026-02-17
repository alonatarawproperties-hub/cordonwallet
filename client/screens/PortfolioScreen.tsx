import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { View, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Image, Platform } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, { useSharedValue, useAnimatedStyle, withSpring, interpolate } from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { useWallet } from "@/lib/wallet-context";
import { useSolanaPortfolio, SolanaAsset } from "@/hooks/useSolanaPortfolio";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { getTokenLogoUrl } from "@/lib/token-logos";
import { getCustomTokens, getHiddenTokens, CustomToken, buildCustomTokenMap } from "@/lib/token-preferences";
import { savePortfolioDisplayCache } from "@/lib/portfolio-cache";
import { AnimatedRefreshIndicator } from "@/components/AnimatedRefreshIndicator";
import { TokenSecurityBadge } from "@/components/TokenSecurityBadge";
import { TokenSecurityModal } from "@/components/TokenSecurityModal";
import type { TokenSecurityAssessment } from "@/lib/token-security";
import type { RiskLevel } from "@/lib/token-security-ui";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

function getTokenIcon(symbol: string): keyof typeof Feather.glyphMap {
  const iconMap: Record<string, keyof typeof Feather.glyphMap> = {
    SOL: "sun",
    USDC: "dollar-sign",
    USDT: "dollar-sign",
    DAI: "disc",
  };
  return iconMap[symbol] || "disc";
}

function getChainColor(chainName: string): string {
  const colorMap: Record<string, string> = {
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

type UnifiedAsset = SolanaAsset & { chainType: "solana" };

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function ActionButton({
  icon,
  label,
  iconColor,
  onPress,
  disabled,
  theme,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  iconColor: string;
  onPress: () => void;
  disabled?: boolean;
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: interpolate(scale.value, [0.93, 1], [0.8, disabled ? 0.4 : 1]),
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.93, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  return (
    <AnimatedPressable
      style={[styles.actionButton, animatedStyle]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
    >
      <View style={[styles.actionCircle, { backgroundColor: iconColor + "12" }]}>
        <Ionicons name={icon} size={22} color={iconColor} />
      </View>
      <ThemedText type="caption" style={[styles.actionLabel, { color: theme.textSecondary }]}>{label}</ThemedText>
    </AnimatedPressable>
  );
}

function AssetRow({
  asset,
  theme,
  onPress,
  securityRisk,
  onSecurityPress,
  isLast,
}: {
  asset: UnifiedAsset;
  theme: ReturnType<typeof useTheme>["theme"];
  onPress: () => void;
  securityRisk?: RiskLevel;
  onSecurityPress?: () => void;
  isLast?: boolean;
}) {
  const scale = useSharedValue(1);
  const [tokenLogoError, setTokenLogoError] = useState(false);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const tokenLogoUrl = ("logoUrl" in asset && asset.logoUrl) ? asset.logoUrl : getTokenLogoUrl(asset.symbol);

  return (
    <AnimatedPressable
      style={[styles.tokenRow, animatedStyle]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <View style={[styles.tokenIcon, { backgroundColor: getChainColor(asset.chainName) + "10" }]}>
        {tokenLogoUrl && !tokenLogoError ? (
          <Image
            source={{ uri: tokenLogoUrl }}
            style={styles.tokenLogoImage}
            onError={() => setTokenLogoError(true)}
          />
        ) : (
          <Feather name={getTokenIcon(asset.symbol)} size={20} color={getChainColor(asset.chainName)} />
        )}
      </View>
      <View style={styles.tokenInfo}>
        <View style={styles.tokenNameRow}>
          <ThemedText type="body" style={styles.tokenSymbol}>
            {asset.symbol}
          </ThemedText>
          {securityRisk && securityRisk !== "safe" && onSecurityPress ? (
            <TokenSecurityBadge
              riskLevel={securityRisk}
              onPress={onSecurityPress}
              size="small"
            />
          ) : null}
        </View>
        <View style={styles.priceRow}>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {asset.priceUsd ? `$${formatPrice(asset.priceUsd)}` : asset.name}
          </ThemedText>
          {asset.priceChange24h !== undefined ? (
            <ThemedText
              type="caption"
              style={{ color: asset.priceChange24h >= 0 ? theme.success : theme.danger, marginLeft: 6, fontSize: 12 }}
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
  const [assetsExpanded, setAssetsExpanded] = useState(false);
  const stableAssetsRef = useRef<UnifiedAsset[]>([]);

  const DEFAULT_VISIBLE_ASSETS = 6;
  const [securityAssessments, setSecurityAssessments] = useState<Map<string, TokenSecurityAssessment>>(new Map());
  const [selectedSecurityAsset, setSelectedSecurityAsset] = useState<{ assessment: TokenSecurityAssessment; name: string; symbol: string } | null>(null);
  const [securityModalVisible, setSecurityModalVisible] = useState(false);

  const solanaAddress = activeWallet?.addresses?.solana;

  const solanaPortfolio = useSolanaPortfolio(solanaAddress);

  useFocusEffect(
    useCallback(() => {
      if (solanaAddress) {
        getCustomTokens(solanaAddress).then(setCustomTokens);
      }
      getHiddenTokens().then(setHiddenTokens);
    }, [solanaAddress])
  );

  const customTokenMap = buildCustomTokenMap(customTokens);

  const { assets, isLoading, isRefreshing, error, lastUpdated, totalValue } = useMemo(() => {
    const solAssets: UnifiedAsset[] = solanaPortfolio.assets.map((a) => {
      const customToken = a.mint ? customTokenMap.get(a.mint.toLowerCase()) : undefined;
      return {
        ...a,
        symbol: customToken?.symbol || a.symbol,
        name: customToken?.name || a.name,
        logoUrl: customToken?.logoUrl || a.logoUrl,
        chainId: 0,
        chainType: "solana" as const,
      };
    });

    let allAssets: UnifiedAsset[];
    if (solanaPortfolio.isRefreshing && stableAssetsRef.current.length > 0) {
      const prevOrder = new Map(stableAssetsRef.current.map((a, i) => [
        `${a.chainType}_${a.symbol}_${a.chainId}`, i
      ]));
      allAssets = solAssets.map((asset) => {
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
      allAssets = solAssets.sort((a, b) => {
        const valueDiff = (b.valueUsd || 0) - (a.valueUsd || 0);
        if (valueDiff !== 0) return valueDiff;
        if (a.isNative && !b.isNative) return -1;
        if (!a.isNative && b.isNative) return 1;
        return a.symbol.localeCompare(b.symbol);
      });
      if (!solanaPortfolio.isLoading) {
        stableAssetsRef.current = allAssets;
      }
    }

    const visibleAssets = allAssets.filter(asset => {
      const tokenKey = `${asset.chainId}:${asset.symbol}`;
      if (hiddenTokens.includes(tokenKey)) return false;
      const balance = parseFloat(asset.balance || "0");
      return balance > 0;
    });

    const total = visibleAssets.reduce((sum, asset) => sum + (asset.valueUsd || 0), 0);
    const latestUpdate = solanaPortfolio.lastUpdated || 0;

    return {
      assets: visibleAssets,
      isLoading: solanaPortfolio.isLoading,
      isRefreshing: solanaPortfolio.isRefreshing,
      error: solanaPortfolio.error,
      lastUpdated: latestUpdate > 0 ? latestUpdate : null,
      totalValue: total,
    };
  }, [solanaPortfolio, customTokenMap, hiddenTokens]);

  const handleRefresh = () => {
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
      decimals: asset.decimals,
    });
  };

  const [refreshing, setRefreshing] = useState(false);
  const REFRESH_TIMEOUT = 15000;

  const handleRefreshWithHaptic = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    try {
      await Promise.race([
        solanaPortfolio.refresh(),
        new Promise(resolve => setTimeout(resolve, REFRESH_TIMEOUT)),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [solanaPortfolio]);

  useEffect(() => {
    if (!isLoading && !isRefreshing && lastUpdated && solanaPortfolio.assets.length > 0) {
      savePortfolioDisplayCache(
        [],
        solanaPortfolio.assets,
        undefined,
        solanaAddress
      );
    }
  }, [lastUpdated, isLoading, isRefreshing, solanaPortfolio.assets, solanaAddress]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const analyzeSolanaTokens = async () => {
      const solanaAssets = assets.filter(a => a.chainType === "solana" && "mint" in a && a.mint);
      if (solanaAssets.length === 0) return;

      try {
        const { Connection } = await import("@solana/web3.js");
        const { RPC_PRIMARY } = await import("@/constants/solanaSwap");
        const { analyzeTokenSecurity } = await import("@/lib/token-security");

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

  const visibleAssets = assetsExpanded ? assets : assets.slice(0, DEFAULT_VISIBLE_ASSETS);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.xl,
        paddingBottom: tabBarHeight + Spacing["3xl"],
        paddingHorizontal: Spacing.xl,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefreshWithHaptic}
          tintColor="transparent"
          colors={["transparent"]}
          progressBackgroundColor="transparent"
          progressViewOffset={headerHeight}
        />
      }
    >
      <AnimatedRefreshIndicator
        isRefreshing={refreshing || isRefreshing}
        color={theme.accent}
        size={24}
      />

      {/* Hero Balance */}
      <View style={styles.balanceHero}>
        <ThemedText type="h1" style={styles.balanceValue}>
          ${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </ThemedText>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionRow}>
        <ActionButton
          icon="paper-plane"
          label="Send"
          iconColor={theme.accent}
          onPress={() => navigation.navigate("Send", {})}
          theme={theme}
        />
        <ActionButton
          icon="arrow-down-circle"
          label="Receive"
          iconColor={theme.success}
          onPress={() =>
            navigation.navigate("Receive", {
              walletAddress:
                activeWallet.addresses?.evm ||
                activeWallet.addresses?.solana ||
                activeWallet.address,
              solanaAddress: activeWallet.addresses?.solana,
            })
          }
          theme={theme}
        />
        <ActionButton
          icon="swap-horizontal"
          label="Swap"
          iconColor={theme.warning}
          onPress={() => (navigation as any).navigate("Swap")}
          theme={theme}
        />
        <ActionButton
          icon="card"
          label="Buy"
          iconColor="#A78BFA"
          onPress={() => navigation.navigate("ManageCrypto")}
          theme={theme}
        />
      </View>

      {/* Assets Section */}
      <View style={styles.assetsSection}>
        <View style={styles.sectionHeader}>
          <ThemedText type="body" style={styles.sectionTitle}>Assets</ThemedText>
          {assets.length > 0 ? (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>{assets.length}</ThemedText>
          ) : null}
        </View>

        {error ? (
          <View style={[styles.errorBanner, { backgroundColor: theme.danger + "10", borderColor: theme.danger + "20" }]}>
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

        <View style={[styles.assetsList, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          {isLoading ? (
            <>
              {[1, 2, 3, 4, 5].map((i) => (
                <View key={i}>
                  <View style={styles.skeletonRow}>
                    <View style={[styles.skeletonIcon, { backgroundColor: theme.backgroundSecondary }]} />
                    <View style={styles.skeletonInfo}>
                      <View style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 60 }]} />
                      <View style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 90 }]} />
                    </View>
                    <View style={styles.skeletonBalance}>
                      <View style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 50 }]} />
                      <View style={[styles.skeletonText, { backgroundColor: theme.backgroundSecondary, width: 40 }]} />
                    </View>
                  </View>
                  {i < 5 ? <View style={[styles.separator, { backgroundColor: theme.separator }]} /> : null}
                </View>
              ))}
            </>
          ) : assets.length === 0 && !error ? (
            <View style={styles.emptyAssets}>
              <Feather name="inbox" size={32} color={theme.textSecondary} style={{ opacity: 0.5 }} />
              <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: Spacing.md }}>
                No assets yet
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary, opacity: 0.7, textAlign: "center" }}>
                Buy or receive crypto to get started
              </ThemedText>
            </View>
          ) : (
            <>
              {visibleAssets.map((asset, index) => {
                const mint = asset.chainType === "solana" && "mint" in asset ? (asset as any).mint as string : undefined;
                const assessment = mint ? securityAssessments.get(mint) : undefined;
                const isLastRow = index === visibleAssets.length - 1;
                return (
                  <View key={`${asset.chainType}-${asset.chainId}-${asset.isNative ? "native" : ("address" in asset ? asset.address : ("mint" in asset ? asset.mint : ""))}-${index}`}>
                    <AssetRow
                      asset={asset}
                      theme={theme}
                      onPress={() => handleAssetPress(asset)}
                      securityRisk={assessment?.overallRisk}
                      onSecurityPress={() => handleSecurityPress(asset)}
                      isLast={isLastRow}
                    />
                    {!isLastRow ? <View style={[styles.separator, { backgroundColor: theme.separator }]} /> : null}
                  </View>
                );
              })}
            </>
          )}
        </View>

        {assets.length > DEFAULT_VISIBLE_ASSETS ? (
          <Pressable
            style={({ pressed }) => [
              styles.viewToggleButton,
              { opacity: pressed ? 0.7 : 1 }
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setAssetsExpanded(!assetsExpanded);
            }}
          >
            <ThemedText type="caption" style={{ color: theme.accent, fontWeight: "500" }}>
              {assetsExpanded ? "Show less" : `View all ${assets.length} assets`}
            </ThemedText>
            <Feather
              name={assetsExpanded ? "chevron-up" : "chevron-down"}
              size={14}
              color={theme.accent}
            />
          </Pressable>
        ) : null}

        <Pressable
          style={styles.manageCryptoButton}
          onPress={() => navigation.navigate("ManageCrypto")}
          hitSlop={8}
        >
          <Feather name="sliders" size={14} color={theme.textSecondary} style={{ marginRight: 6 }} />
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Manage tokens
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
    alignItems: "center",
    justifyContent: "center",
  },

  // Hero Balance
  balanceHero: {
    alignItems: "center",
    paddingTop: Spacing.md,
    paddingBottom: Spacing["3xl"],
  },
  balanceValue: {
    fontSize: 42,
    fontWeight: "700",
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
  },

  // Action Buttons
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-evenly",
    paddingBottom: Spacing["4xl"],
    paddingHorizontal: Spacing.lg,
  },
  actionButton: {
    alignItems: "center",
    gap: Spacing.sm,
    minWidth: 56,
  },
  actionCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: "500",
  },

  // Assets Section
  assetsSection: {
    gap: Spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  assetsList: {
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    borderWidth: 1,
  },

  // Asset Row
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  tokenIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tokenLogoImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  tokenInfo: {
    flex: 1,
    gap: 3,
  },
  tokenNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  tokenSymbol: {
    fontWeight: "600",
    fontSize: 16,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  tokenBalance: {
    alignItems: "flex-end",
    gap: 3,
  },
  balanceAmount: {
    fontWeight: "600",
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 72,
  },

  // Error
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },

  // Loading
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  skeletonIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
    borderRadius: 6,
  },

  // Empty
  emptyAssets: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["5xl"],
    paddingHorizontal: Spacing.xl,
    gap: Spacing.xs,
  },

  // Bottom actions
  manageCryptoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    marginTop: Spacing.xs,
  },
  viewToggleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.md,
  },
});
