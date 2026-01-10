import React, { useState, useEffect, useCallback, useLayoutEffect } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Switch,
  ActivityIndicator,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight, HeaderButton } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { useWallet } from "@/lib/wallet-context";
import { useAllChainsPortfolio, MultiChainAsset } from "@/hooks/useAllChainsPortfolio";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import { getHiddenTokens, hideToken, showToken, getCustomTokens, CustomToken } from "@/lib/token-preferences";
import { supportedChains, ChainConfig } from "@/lib/blockchain/chains";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { getTokenLogoUrl } from "@/lib/token-logos";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const chainFilters = [
  { id: "all", name: "All", icon: "globe" },
  { id: "1", name: "ETH", color: "#627EEA" },
  { id: "137", name: "POL", color: "#8247E5" },
  { id: "56", name: "BNB", color: "#F3BA2F" },
  { id: "solana", name: "SOL", color: "#9945FF" },
];

export default function ManageCryptoScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NavigationProp>();
  const { activeWallet } = useWallet();
  
  const walletType = (activeWallet as any)?.walletType || "multi-chain";
  const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address;
  const solanaAddress = activeWallet?.addresses?.solana;
  
  const { assets: evmAssets, isLoading: evmLoading } = useAllChainsPortfolio(
    walletType === "solana-only" ? undefined : evmAddress
  );
  const { assets: solanaAssets, isLoading: solanaLoading } = useSolanaPortfolio(solanaAddress);
  
  const assets: MultiChainAsset[] = [
    ...(walletType === "solana-only" ? [] : evmAssets),
    ...solanaAssets.map(a => ({
      symbol: a.symbol,
      name: a.name,
      chainId: 0,
      chainName: "Solana",
      isNative: a.isNative,
      balance: a.balance,
      rawBalance: a.rawBalance,
      decimals: a.decimals,
      address: a.mint,
      valueUsd: a.valueUsd,
      priceUsd: a.priceUsd,
    })),
  ];
  const isLoading = (walletType === "solana-only" ? false : evmLoading) || solanaLoading;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChain, setSelectedChain] = useState("all");
  const [hiddenTokens, setHiddenTokens] = useState<string[]>([]);
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(true);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderButton onPress={() => navigation.navigate("ImportToken")}>
          <Feather name="plus" size={24} color={theme.accent} />
        </HeaderButton>
      ),
    });
  }, [navigation, theme]);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    setIsLoadingPrefs(true);
    const [hidden, custom] = await Promise.all([
      getHiddenTokens(),
      getCustomTokens(),
    ]);
    setHiddenTokens(hidden);
    setCustomTokens(custom);
    setIsLoadingPrefs(false);
  };

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

  const getChainName = (chainId: number): string => {
    if (chainId === 0) return "Solana";
    return supportedChains.find((c: ChainConfig) => c.chainId === chainId)?.name || "Unknown";
  };

  const allAssets: MultiChainAsset[] = [...assets, ...customTokens.map((ct: CustomToken) => ({
    symbol: ct.symbol,
    name: ct.name,
    chainId: ct.chainId,
    chainName: getChainName(ct.chainId),
    isNative: false,
    balance: "0",
    address: ct.contractAddress,
  } as MultiChainAsset))];

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
      case 1: return "#627EEA";
      case 137: return "#8247E5";
      case 56: return "#F3BA2F";
      default: return theme.textSecondary;
    }
  };

  const renderAssetItem = ({ item }: { item: MultiChainAsset }) => {
    const visible = !isHidden(item.chainId, item.symbol);
    
    return (
      <View style={[styles.assetRow, { borderBottomColor: theme.border }]}>
        <View style={[styles.assetIcon, { backgroundColor: getChainColor(item.chainId) + "20" }]}>
          {getTokenLogoUrl(item.symbol) ? (
            <Image 
              source={{ uri: getTokenLogoUrl(item.symbol)! }} 
              style={styles.tokenLogoImage}
            />
          ) : (
            <ThemedText type="body" style={{ color: getChainColor(item.chainId), fontWeight: "600" }}>
              {item.symbol.slice(0, 2)}
            </ThemedText>
          )}
        </View>
        <View style={styles.assetInfo}>
          <View style={styles.assetNameRow}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>{item.symbol}</ThemedText>
            <View style={[styles.chainBadge, { backgroundColor: getChainColor(item.chainId) + "20" }]}>
              <ThemedText type="small" style={{ color: getChainColor(item.chainId), fontSize: 10 }}>
                {item.chainName}
              </ThemedText>
            </View>
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {item.name}
          </ThemedText>
        </View>
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
          {chainFilters.map((chain) => (
            <Pressable
              key={chain.id}
              style={[
                styles.chainChip,
                { 
                  backgroundColor: selectedChain === chain.id 
                    ? (chain.color || theme.accent) 
                    : theme.backgroundDefault,
                },
              ]}
              onPress={() => setSelectedChain(chain.id)}
            >
              {chain.icon ? (
                <Feather 
                  name={chain.icon as any} 
                  size={14} 
                  color={selectedChain === chain.id ? "#FFF" : theme.textSecondary} 
                />
              ) : (
                <ThemedText 
                  type="small" 
                  style={{ 
                    color: selectedChain === chain.id ? "#FFF" : theme.text,
                    fontWeight: "600",
                  }}
                >
                  {chain.name}
                </ThemedText>
              )}
            </Pressable>
          ))}
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
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    gap: Spacing.md,
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
