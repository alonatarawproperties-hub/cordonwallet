import { useState, useMemo, useEffect } from "react";
import { View, StyleSheet, Pressable, FlatList, TextInput, ScrollView, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useWallet } from "@/lib/wallet-context";
import { useAllChainsPortfolio, MultiChainAsset } from "@/hooks/useAllChainsPortfolio";
import { useSolanaPortfolio, SolanaAsset } from "@/hooks/useSolanaPortfolio";
import { getCustomTokens, CustomToken } from "@/lib/token-preferences";
import { getTokenLogoUrl as getStandardTokenLogo } from "@/lib/token-logos";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Send">;

interface UnifiedAsset {
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  isNative: boolean;
  address?: string;
  mint?: string;
  chainId: number | string;
  chainName: string;
  chainType: "evm" | "solana";
  priceUsd?: number;
  valueUsd?: number;
  logoUrl?: string;
}

interface ChainFilter {
  id: string;
  name: string;
  color: string;
  logoUrl?: string;
}

const CHAIN_FILTERS: ChainFilter[] = [
  { id: "all", name: "All", color: "#22C55E" },
  { id: "ethereum", name: "ETH", color: "#627EEA", logoUrl: "https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
  { id: "polygon", name: "POL", color: "#8247E5", logoUrl: "https://coin-images.coingecko.com/coins/images/32440/small/polygon.png" },
  { id: "bsc", name: "BNB", color: "#F0B90B", logoUrl: "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" },
  { id: "arbitrum", name: "ARB", color: "#28A0F0", logoUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png" },
  { id: "base", name: "BASE", color: "#0052FF", logoUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png" },
  { id: "solana", name: "SOL", color: "#9945FF", logoUrl: "https://assets.coingecko.com/coins/images/4128/small/solana.png" },
];

function getChainFilterKey(chainId: number | string): string {
  if (chainId === "solana" || chainId === 0) return "solana";
  switch (chainId) {
    case 1:
    case 11155111:
      return "ethereum";
    case 137:
    case 80002:
      return "polygon";
    case 56:
    case 97:
      return "bsc";
    case 42161:
      return "arbitrum";
    case 8453:
      return "base";
    default:
      return String(chainId);
  }
}

function getChainColor(chainName: string): string {
  const colors: Record<string, string> = {
    "Ethereum": "#627EEA",
    "Polygon": "#8247E5",
    "BNB Chain": "#F0B90B",
    "Arbitrum": "#12AAFF",
    "Base": "#0052FF",
    "Solana": "#9945FF",
  };
  return colors[chainName] || "#6B7280";
}

function getTokenLogoUrl(asset: UnifiedAsset, customTokens: CustomToken[]): string | undefined {
  if (asset.logoUrl) return asset.logoUrl;
  
  if (asset.chainType === "solana" && asset.mint) {
    const customToken = customTokens.find(
      ct => ct.contractAddress.toLowerCase() === asset.mint?.toLowerCase() && ct.chainId === 0
    );
    if (customToken?.logoUrl) return customToken.logoUrl;
  }
  
  const standardLogo = getStandardTokenLogo(asset.symbol);
  if (standardLogo) return standardLogo;
  
  return undefined;
}

export default function SendScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { activeWallet } = useWallet();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilter, setSelectedFilter] = useState("all");
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);

  const presetAsset = route.params?.presetAsset;

  useEffect(() => {
    if (presetAsset) {
      navigation.replace("SendDetails", {
        tokenSymbol: presetAsset.symbol,
        tokenAddress: presetAsset.address || presetAsset.mint,
        chainType: presetAsset.chainType,
        chainId: presetAsset.chainId,
        decimals: presetAsset.decimals,
        balance: presetAsset.balance,
        priceUsd: presetAsset.priceUsd,
        isNative: presetAsset.isNative,
        logoUrl: presetAsset.logoUrl,
      });
    }
  }, [presetAsset?.symbol]);

  const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address || "";
  const solanaAddress = activeWallet?.addresses?.solana || "";
  const isSolanaOnly = activeWallet?.walletType === "solana-only";

  const { assets: evmAssets, isLoading: evmLoading } = useAllChainsPortfolio(
    isSolanaOnly ? undefined : evmAddress || undefined
  );
  const { assets: solanaAssets, isLoading: solanaLoading } = useSolanaPortfolio(solanaAddress || undefined);

  useEffect(() => {
    if (solanaAddress) {
      getCustomTokens(solanaAddress).then(setCustomTokens);
    }
  }, [solanaAddress]);

  const unifiedAssets = useMemo((): UnifiedAsset[] => {
    const assets: UnifiedAsset[] = [];

    if (!isSolanaOnly) {
      evmAssets.forEach((asset: MultiChainAsset) => {
        assets.push({
          symbol: asset.symbol,
          name: asset.name,
          balance: asset.balance,
          decimals: asset.decimals,
          isNative: asset.isNative,
          address: asset.address,
          chainId: asset.chainId,
          chainName: asset.chainName,
          chainType: "evm",
          priceUsd: asset.priceUsd,
          valueUsd: asset.valueUsd,
          logoUrl: asset.logoURI,
        });
      });
    }

    solanaAssets.forEach((asset: SolanaAsset) => {
      assets.push({
        symbol: asset.symbol,
        name: asset.name,
        balance: asset.balance,
        decimals: asset.decimals,
        isNative: asset.isNative,
        mint: asset.mint,
        chainId: "solana",
        chainName: "Solana",
        chainType: "solana",
        priceUsd: asset.priceUsd,
        valueUsd: asset.valueUsd,
        logoUrl: asset.logoUrl,
      });
    });

    assets.sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));

    return assets;
  }, [evmAssets, solanaAssets, isSolanaOnly]);

  const filteredAssets = useMemo(() => {
    let filtered = unifiedAssets;

    if (selectedFilter !== "all") {
      filtered = filtered.filter((asset) => {
        const filterKey = getChainFilterKey(asset.chainId);
        return filterKey === selectedFilter;
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (asset) =>
          asset.symbol.toLowerCase().includes(query) ||
          asset.name.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [unifiedAssets, selectedFilter, searchQuery]);

  const chainCounts = useMemo(() => {
    const counts: Record<string, number> = { all: unifiedAssets.length };
    unifiedAssets.forEach((asset) => {
      const filterKey = getChainFilterKey(asset.chainId);
      if (filterKey) {
        counts[filterKey] = (counts[filterKey] || 0) + 1;
      }
    });
    return counts;
  }, [unifiedAssets]);

  const handleSelectToken = (asset: UnifiedAsset) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const logoUrl = getTokenLogoUrl(asset, customTokens);
    navigation.push("SendDetails", {
      tokenSymbol: asset.symbol,
      tokenAddress: asset.address || asset.mint,
      chainType: asset.chainType,
      chainId: typeof asset.chainId === "number" ? asset.chainId : 0,
      decimals: asset.decimals,
      balance: asset.balance,
      priceUsd: asset.priceUsd,
      isNative: asset.isNative,
      logoUrl,
    });
  };

  const isLoading = evmLoading || solanaLoading;

  const renderChainFilter = (filter: ChainFilter) => {
    const isSelected = selectedFilter === filter.id;
    const count = chainCounts[filter.id] || 0;
    
    if (filter.id !== "all" && count === 0) return null;

    return (
      <Pressable
        key={filter.id}
        style={[
          styles.filterPill,
          {
            backgroundColor: isSelected ? filter.color : theme.backgroundDefault,
            borderColor: isSelected ? filter.color : theme.border,
          },
        ]}
        onPress={() => setSelectedFilter(filter.id)}
      >
        {filter.id === "all" ? (
          <ThemedText
            type="small"
            style={{ color: isSelected ? "#FFFFFF" : theme.textSecondary, fontWeight: "600" }}
          >
            All
          </ThemedText>
        ) : filter.logoUrl ? (
          <Image source={{ uri: filter.logoUrl }} style={styles.filterLogo} />
        ) : (
          <View style={[styles.filterDot, { backgroundColor: filter.color }]} />
        )}
      </Pressable>
    );
  };

  const renderTokenItem = ({ item }: { item: UnifiedAsset }) => {
    const logoUrl = getTokenLogoUrl(item, customTokens);
    const cleanBalance = item.balance.replace(/[<>,]/g, "").trim();
    const balanceNum = parseFloat(cleanBalance) || 0;
    const calculatedValue = item.valueUsd ?? (item.priceUsd ? item.priceUsd * balanceNum : 0);
    const valueFormatted = isNaN(calculatedValue) || calculatedValue === 0 
      ? "$0.00" 
      : `$${calculatedValue.toFixed(2)}`;

    return (
      <Pressable
        style={[styles.tokenRow, { borderBottomColor: theme.border }]}
        onPress={() => handleSelectToken(item)}
        testID={`token-row-${item.symbol}`}
      >
        <View style={styles.tokenLeft}>
          <View style={[styles.tokenIcon, { backgroundColor: theme.backgroundDefault }]}>
            {logoUrl ? (
              <Image source={{ uri: logoUrl }} style={styles.tokenLogo} />
            ) : (
              <ThemedText type="body" style={{ fontWeight: "700" }}>
                {item.symbol.slice(0, 2)}
              </ThemedText>
            )}
          </View>
          <View style={styles.tokenInfo}>
            <View style={styles.tokenNameRow}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {item.symbol}
              </ThemedText>
              <View style={[styles.chainBadge, { backgroundColor: getChainColor(item.chainName) + "20" }]}>
                <ThemedText
                  type="caption"
                  style={{ color: getChainColor(item.chainName), fontSize: 10 }}
                >
                  {item.chainName}
                </ThemedText>
              </View>
            </View>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.name}
            </ThemedText>
          </View>
        </View>
        <View style={styles.tokenRight}>
          <ThemedText type="body" style={{ fontWeight: "600", textAlign: "right" }}>
            {item.balance}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "right" }}>
            {valueFormatted}
          </ThemedText>
        </View>
      </Pressable>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.content, { paddingTop: headerHeight + Spacing.md }]}>
        <View style={[styles.searchContainer, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="search" size={18} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search"
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 ? (
            <Pressable onPress={() => setSearchQuery("")}>
              <Feather name="x" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.filtersContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersScroll}
          >
            {CHAIN_FILTERS.map(renderChainFilter)}
          </ScrollView>
          <View style={[styles.countBadge, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              {chainCounts[selectedFilter] || 0}
            </ThemedText>
            <Feather name="chevron-down" size={14} color={theme.textSecondary} />
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.accent} />
          </View>
        ) : (
          <FlatList
            data={filteredAssets}
            renderItem={renderTokenItem}
            keyExtractor={(item) => `${item.chainId}-${item.symbol}-${item.address || item.mint || "native"}`}
            contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <ThemedText type="body" style={{ color: theme.textSecondary }}>
                  No tokens found
                </ThemedText>
              </View>
            }
          />
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.xs,
  },
  filtersContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  filtersScroll: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    minWidth: 40,
  },
  filterDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  filterLogo: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  countBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
    marginLeft: "auto",
  },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    borderBottomWidth: 0.5,
  },
  tokenLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Spacing.md,
  },
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tokenLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  tokenInfo: {
    flex: 1,
    gap: 2,
  },
  tokenNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  chainBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  tokenRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContainer: {
    padding: Spacing["2xl"],
    alignItems: "center",
  },
});
