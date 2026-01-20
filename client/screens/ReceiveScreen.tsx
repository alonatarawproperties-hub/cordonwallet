import { useState, useMemo, useEffect } from "react";
import { View, StyleSheet, Pressable, FlatList, TextInput, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useWallet } from "@/lib/wallet-context";
import { useAllChainsPortfolio, MultiChainAsset } from "@/hooks/useAllChainsPortfolio";
import { useSolanaPortfolio, SolanaAsset } from "@/hooks/useSolanaPortfolio";
import { getCustomTokens, CustomToken } from "@/lib/token-preferences";
import { getTokenLogoUrl as getStandardTokenLogo } from "@/lib/token-logos";
import { ChainBadge } from "@/components/ChainBadge";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Receive">;

interface UnifiedAsset {
  symbol: string;
  name: string;
  chainId: number | string;
  chainName: string;
  chainType: "evm" | "solana";
  address?: string;
  mint?: string;
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

function shortenAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
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

export default function ReceiveScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { activeWallet } = useWallet();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFilter, setSelectedFilter] = useState("all");
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<UnifiedAsset | null>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);

  const evmAddress = route.params.walletAddress;
  const solanaAddress = route.params.solanaAddress || activeWallet?.addresses?.solana || "";
  const isSolanaOnly = activeWallet?.walletType === "solana-only";
  const preselectedToken = route.params.preselectedToken;

  // Auto-select preselected token on mount
  useEffect(() => {
    if (preselectedToken && !selectedAsset) {
      setSelectedAsset({
        symbol: preselectedToken.symbol,
        name: preselectedToken.name,
        chainId: preselectedToken.chainId,
        chainName: preselectedToken.chainName,
        chainType: preselectedToken.chainType,
        address: preselectedToken.address,
        mint: preselectedToken.mint,
        logoUrl: preselectedToken.logoUrl,
      });
    }
  }, [preselectedToken]);

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
    const seen = new Set<string>();

    if (!isSolanaOnly) {
      evmAssets.forEach((asset: MultiChainAsset) => {
        const key = `${asset.chainId}-${asset.symbol}`;
        if (!seen.has(key)) {
          seen.add(key);
          assets.push({
            symbol: asset.symbol,
            name: asset.name,
            chainId: asset.chainId,
            chainName: asset.chainName,
            chainType: "evm",
            address: asset.address,
            logoUrl: asset.logoURI,
          });
        }
      });
    }

    solanaAssets.forEach((asset: SolanaAsset) => {
      const key = `solana-${asset.mint || "native"}`;
      if (!seen.has(key)) {
        seen.add(key);
        assets.push({
          symbol: asset.symbol,
          name: asset.name,
          chainId: "solana",
          chainName: "Solana",
          chainType: "solana",
          mint: asset.mint,
          logoUrl: asset.logoUrl,
        });
      }
    });

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

  const getAddressForAsset = (asset: UnifiedAsset): string => {
    return asset.chainType === "solana" ? solanaAddress : evmAddress;
  };

  const handleCopyAddress = async (asset: UnifiedAsset) => {
    const address = getAddressForAsset(asset);
    await Clipboard.setStringAsync(address);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleShowQR = (asset: UnifiedAsset) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedAsset(asset);
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
    const walletAddress = getAddressForAsset(item);

    const badgeChainId: any = item.chainId ?? null;
    const numericChainId = typeof badgeChainId === "string" ? Number(badgeChainId) : (badgeChainId as number | null);
    const isSolana = badgeChainId === 0 || badgeChainId === "solana" || item.chainType === "solana";
    const isPolygon = numericChainId === 137;
    const isBsc = numericChainId === 56;
    const isArb = numericChainId === 42161;
    const shouldShowBadge = !isSolana && (isPolygon || isBsc || isArb);

    return (
      <View style={[styles.tokenRow, { borderBottomColor: theme.border }]}>
        <View style={styles.tokenLeft}>
          <View style={styles.iconWrap}>
            <View style={[styles.tokenIcon, { backgroundColor: theme.backgroundDefault }]}>
              {logoUrl ? (
                <Image source={{ uri: logoUrl }} style={styles.tokenLogo} />
              ) : (
                <ThemedText type="body" style={{ fontWeight: "700" }}>
                  {item.symbol.slice(0, 2)}
                </ThemedText>
              )}
            </View>
            {shouldShowBadge ? (
              <View style={styles.badgePos}>
                <ChainBadge chainId={badgeChainId} size={14} />
              </View>
            ) : null}
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
              {shortenAddress(walletAddress)}
            </ThemedText>
          </View>
        </View>
        <View style={styles.tokenActions}>
          <Pressable
            style={[styles.actionButton, { backgroundColor: theme.backgroundDefault }]}
            onPress={() => handleShowQR(item)}
            testID={`qr-button-${item.symbol}`}
          >
            <Feather name="grid" size={18} color={theme.textSecondary} />
          </Pressable>
          <Pressable
            style={[styles.actionButton, { backgroundColor: theme.backgroundDefault }]}
            onPress={() => handleCopyAddress(item)}
            testID={`copy-button-${item.symbol}`}
          >
            <Feather name="copy" size={18} color={theme.textSecondary} />
          </Pressable>
        </View>
      </View>
    );
  };

  if (selectedAsset) {
    const address = getAddressForAsset(selectedAsset);
    
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.qrContent, { paddingTop: headerHeight + Spacing.xl }]}>
          <Pressable 
            style={styles.backButton}
            onPress={() => setSelectedAsset(null)}
          >
            <Feather name="arrow-left" size={24} color={theme.text} />
          </Pressable>

          <View style={[styles.qrCard, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.qrTokenHeader}>
              {(() => {
                const logoUrl = getTokenLogoUrl(selectedAsset, customTokens);
                return logoUrl ? (
                  <Image source={{ uri: logoUrl }} style={styles.qrTokenLogo} />
                ) : null;
              })()}
              <ThemedText type="h3">{selectedAsset.symbol}</ThemedText>
              <View style={[styles.chainBadgeLarge, { backgroundColor: getChainColor(selectedAsset.chainName) + "20" }]}>
                <ThemedText type="small" style={{ color: getChainColor(selectedAsset.chainName) }}>
                  {selectedAsset.chainName}
                </ThemedText>
              </View>
            </View>

            <View style={styles.qrContainer}>
              <QRCode
                value={address}
                size={200}
                backgroundColor="white"
                color="black"
              />
            </View>

            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
              Scan to receive {selectedAsset.symbol}
            </ThemedText>

            <View style={[styles.addressBox, { backgroundColor: theme.backgroundRoot }]}>
              <ThemedText type="small" style={{ fontFamily: "monospace", textAlign: "center" }}>
                {address}
              </ThemedText>
            </View>

            {selectedAsset.chainType === "solana" ? (
              <View style={[styles.warningBox, { backgroundColor: theme.warning + "15" }]}>
                <Feather name="alert-triangle" size={16} color={theme.warning} />
                <ThemedText type="caption" style={{ color: theme.warning, flex: 1 }}>
                  Only send Solana (SOL) and SPL tokens to this address
                </ThemedText>
              </View>
            ) : null}

            <Pressable
              style={[styles.copyButton, { backgroundColor: theme.accent }]}
              onPress={() => handleCopyAddress(selectedAsset)}
            >
              <Feather name={copiedAddress ? "check" : "copy"} size={18} color="#FFFFFF" />
              <ThemedText type="body" style={{ color: "#FFFFFF", fontWeight: "600" }}>
                {copiedAddress ? "Copied!" : "Copy Address"}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </ThemedView>
    );
  }

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

        <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
          All crypto
        </ThemedText>

        {copiedAddress ? (
          <View style={[styles.copiedToast, { backgroundColor: theme.success }]}>
            <Feather name="check" size={16} color="#FFFFFF" />
            <ThemedText type="small" style={{ color: "#FFFFFF", fontWeight: "600" }}>
              Address copied!
            </ThemedText>
          </View>
        ) : null}

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
  iconWrap: {
    position: "relative",
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  badgePos: {
    position: "absolute",
    right: -2,
    bottom: -2,
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
  chainBadgeLarge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  tokenActions: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
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
  copiedToast: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  qrContent: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  backButton: {
    marginBottom: Spacing.lg,
  },
  qrCard: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    gap: Spacing.lg,
  },
  qrTokenHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  qrTokenLogo: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  qrContainer: {
    padding: Spacing.lg,
    backgroundColor: "white",
    borderRadius: BorderRadius.md,
  },
  addressBox: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    width: "100%",
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
    width: "100%",
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.full,
    gap: Spacing.sm,
    width: "100%",
  },
});
