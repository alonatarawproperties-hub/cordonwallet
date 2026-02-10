import React, { useState, useCallback, useLayoutEffect } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Switch,
  ActivityIndicator,
  Image,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight, HeaderButton } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation, useFocusEffect } from "@react-navigation/native";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { useWallet } from "@/lib/wallet-context";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import { getHiddenTokens, hideToken, showToken, getCustomTokens, removeCustomToken, CustomToken, buildCustomTokenMap, clearGlobalCustomTokens } from "@/lib/token-preferences";
import { supportedChains, ChainConfig } from "@/lib/blockchain/chains";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { getTokenLogoUrl } from "@/lib/token-logos";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type AssetItem = {
  symbol: string;
  name: string;
  chainId: number;
  chainName: string;
  isNative: boolean;
  balance: string;
  rawBalance: bigint;
  decimals: number;
  address?: string;
  valueUsd?: number;
  priceUsd?: number;
  logoURI?: string;
  logoUrl?: string;
};

const chainFilters = [
  { id: "all", name: "All", icon: "globe", color: "#6366F1" },
  { id: "solana", name: "SOL", color: "#9945FF", logoUrl: "https://assets.coingecko.com/coins/images/4128/small/solana.png" },
];

export default function ManageCryptoScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NavigationProp>();
  const { activeWallet } = useWallet();
  
  const solanaAddress = activeWallet?.addresses?.solana;

  const { assets: solanaAssets, isLoading: solanaLoading, refresh: refreshSolana } = useSolanaPortfolio(solanaAddress);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChain, setSelectedChain] = useState("all");
  const [hiddenTokens, setHiddenTokens] = useState<string[]>([]);
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(true);
  
  const customTokenMap = buildCustomTokenMap(customTokens);
  
  const assets: AssetItem[] = solanaAssets.map(a => {
    const customToken = a.mint ? customTokenMap.get(a.mint.toLowerCase()) : undefined;
    return {
      symbol: customToken?.symbol || a.symbol,
      name: customToken?.name || a.name,
      chainId: 0,
      chainName: "Solana",
      isNative: a.isNative,
      balance: a.balance,
      rawBalance: a.rawBalance,
      decimals: a.decimals,
      address: a.mint,
      valueUsd: a.valueUsd,
      priceUsd: a.priceUsd,
      logoUrl: customToken?.logoUrl || a.logoUrl, // Preserve original logo from portfolio
    };
  });
  const isLoading = solanaLoading;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderButton onPress={() => navigation.navigate("ImportToken")}>
          <Feather name="plus" size={24} color={theme.accent} />
        </HeaderButton>
      ),
    });
  }, [navigation, theme]);

  const loadPreferences = useCallback(async () => {
    if (!solanaAddress) return;
    setIsLoadingPrefs(true);
    await clearGlobalCustomTokens();
    const [hidden, custom] = await Promise.all([
      getHiddenTokens(),
      getCustomTokens(solanaAddress),
    ]);
    setHiddenTokens(hidden);
    setCustomTokens(custom);
    setIsLoadingPrefs(false);
  }, [solanaAddress]);

  useFocusEffect(
    useCallback(() => {
      loadPreferences();
    }, [loadPreferences])
  );

  const getTokenKey = (chainId: number, symbol: string) => `${chainId}:${symbol}`;

  const isHidden = (chainId: number, symbol: string) => {
    return hiddenTokens.includes(getTokenKey(chainId, symbol));
  };

  const handleToggle = async (chainId: number, symbol: string, visible: boolean) => {
    if (visible) {
      await showToken(chainId, symbol);
      setHiddenTokens(prev => prev.filter(k => k !== getTokenKey(chainId, symbol)));
    } else {
      await hideToken(chainId, symbol);
      setHiddenTokens(prev => [...prev, getTokenKey(chainId, symbol)]);
    }
  };

  const isCustomToken = (chainId: number, address?: string): boolean => {
    if (!address) return false;
    return customTokens.some(
      ct => ct.chainId === chainId && ct.contractAddress.toLowerCase() === address.toLowerCase()
    );
  };

  const handleDeleteCustomToken = (chainId: number, symbol: string, address: string) => {
    Alert.alert(
      "Remove Token",
      `Are you sure you want to remove ${symbol}? You can add it again later.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await removeCustomToken(chainId, address, solanaAddress);
            setCustomTokens(prev => prev.filter(
              ct => !(ct.chainId === chainId && ct.contractAddress.toLowerCase() === address.toLowerCase())
            ));
          },
        },
      ]
    );
  };

  const getChainName = (chainId: number): string => {
    if (chainId === 0) return "Solana";
    return supportedChains.find((c: ChainConfig) => c.chainId === chainId)?.name || "Unknown";
  };

  type AssetWithLogo = AssetItem & { logoUrl?: string };

  const assetsWithLogos: AssetWithLogo[] = assets.map(a => ({ ...a })); // Preserve existing logoUrl
  const customAssetsWithLogos: AssetWithLogo[] = customTokens.map((ct: CustomToken) => ({
    symbol: ct.symbol,
    name: ct.name,
    chainId: ct.chainId,
    chainName: getChainName(ct.chainId),
    isNative: false,
    balance: "0",
    rawBalance: BigInt(0),
    decimals: ct.decimals,
    address: ct.contractAddress,
    logoUrl: ct.logoUrl,
  }));
  
  const allAssets: AssetWithLogo[] = [...assetsWithLogos, ...customAssetsWithLogos];

  const uniqueAssets = allAssets.filter((asset, index, self) => 
    index === self.findIndex(a => a.chainId === asset.chainId && a.symbol === asset.symbol)
  );

  const filteredAssets = uniqueAssets.filter(asset => {
    const matchesSearch = 
      asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.name.toLowerCase().includes(searchQuery.toLowerCase());
    const chainKey = asset.chainId === 0 ? "solana" : asset.chainId.toString();
    const matchesChain = selectedChain === "all" || chainKey === selectedChain;
    return matchesSearch && matchesChain;
  });

  const getChainColor = (chainId: number) => {
    switch (chainId) {
      case 0: return "#9945FF";
      default: return theme.textSecondary;
    }
  };

  const getCustomTokenLogoUrl = (chainId: number, address?: string): string | undefined => {
    if (!address) return undefined;
    const customToken = customTokens.find(
      ct => ct.chainId === chainId && ct.contractAddress.toLowerCase() === address.toLowerCase()
    );
    return customToken?.logoUrl;
  };

  const renderAssetItem = ({ item }: { item: AssetItem & { logoUrl?: string } }) => {
    const visible = !isHidden(item.chainId, item.symbol);
    const itemIsCustom = isCustomToken(item.chainId, item.address);
    const itemLogoUrl = item.logoURI || item.logoUrl || getCustomTokenLogoUrl(item.chainId, item.address) || getTokenLogoUrl(item.symbol);

    return (
      <View style={[styles.assetRow, { borderBottomColor: theme.border }]}>
        <View style={styles.iconWrap}>
          <View style={[styles.assetIcon, { backgroundColor: getChainColor(item.chainId) + "20" }]}>
            {itemLogoUrl ? (
              <Image
                source={{ uri: itemLogoUrl }}
                style={styles.tokenLogoImage}
              />
            ) : (
              <ThemedText type="body" style={{ color: getChainColor(item.chainId), fontWeight: "600" }}>
                {item.symbol.slice(0, 2)}
              </ThemedText>
            )}
          </View>
        </View>
        <View style={styles.assetInfo}>
          <View style={styles.assetNameRow}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>{item.symbol}</ThemedText>
            <View style={[styles.chainBadge, { backgroundColor: getChainColor(item.chainId) + "20" }]}>
              <ThemedText type="small" style={{ color: getChainColor(item.chainId), fontSize: 10 }}>
                {item.chainName}
              </ThemedText>
            </View>
            {itemIsCustom ? (
              <View style={[styles.customBadge, { backgroundColor: theme.accent + "20" }]}>
                <ThemedText type="small" style={{ color: theme.accent, fontSize: 10 }}>
                  Custom
                </ThemedText>
              </View>
            ) : null}
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {item.name}
          </ThemedText>
        </View>
        {/* Show delete only for custom tokens that have zero balance (manually added tokens) */}
        {itemIsCustom && item.address && parseFloat(item.balance.replace(/,/g, "")) === 0 ? (
          <Pressable
            style={styles.deleteButton}
            onPress={() => handleDeleteCustomToken(item.chainId, item.symbol, item.address!)}
          >
            <Feather name="trash-2" size={18} color="#EF4444" />
          </Pressable>
        ) : null}
        <Switch
          value={visible}
          onValueChange={(value) => handleToggle(item.chainId, item.symbol, value)}
          trackColor={{ false: theme.border, true: "#22C55E" }}
          thumbColor="#FFFFFF"
        />
      </View>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.content, { paddingTop: headerHeight + Spacing.sm }]}>
        <View style={[styles.searchContainer, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="search" size={18} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search"
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <View style={styles.chainFilters}>
          {chainFilters.map((chain) => {
            const isSelected = selectedChain === chain.id;
            return (
              <Pressable
                key={chain.id}
                style={[
                  styles.chainChipCircle,
                  { 
                    borderColor: isSelected ? chain.color : "transparent",
                    borderWidth: isSelected ? 2 : 0,
                  },
                ]}
                onPress={() => setSelectedChain(chain.id)}
              >
                {chain.icon ? (
                  <View style={[styles.chainIconCircle, { backgroundColor: chain.color }]}>
                    <Feather name={chain.icon as any} size={18} color="#FFF" />
                  </View>
                ) : (
                  <Image 
                    source={{ uri: chain.logoUrl }} 
                    style={styles.chainLogoImage}
                  />
                )}
              </Pressable>
            );
          })}
        </View>

        {isLoading || isLoadingPrefs ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.accent} />
          </View>
        ) : (
          <FlatList
            data={filteredAssets}
            keyExtractor={(item) => `${item.chainId}:${item.symbol}`}
            renderItem={renderAssetItem}
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Feather name="inbox" size={40} color={theme.textSecondary} />
                <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: Spacing.md }}>
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
    paddingHorizontal: Spacing.md,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 12,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  chainFilters: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  chainChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 20,
  },
  chainChipCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  },
  chainIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  chainLogoImage: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
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
  assetIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tokenLogoImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  assetInfo: {
    flex: 1,
  },
  assetNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  chainBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  customBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  deleteButton: {
    padding: Spacing.sm,
    marginRight: Spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
  },
});
