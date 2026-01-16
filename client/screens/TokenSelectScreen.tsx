import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { TokenInfo } from "@/services/solanaTokenList";
import { searchTokens, getPopularTokens } from "@/services/solanaTokenList";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import { useWallet } from "@/lib/wallet-context";
import { getApiUrl } from "@/lib/query-client";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

export interface TokenSelectParams {
  mode: "input" | "output";
  onSelect: (token: TokenInfo) => void;
  excludeMint?: string;
}

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type TokenSelectRouteProp = RouteProp<{ TokenSelect: TokenSelectParams }, "TokenSelect">;

const RECENTLY_USED_KEY = "swap_recently_used_tokens";
const MAX_RECENTLY_USED = 8;

interface RecentToken {
  mint: string;
  symbol: string;
  name: string;
  logoURI?: string;
  decimals: number;
}

function isLikelySolanaMint(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
}

async function loadRecentlyUsed(): Promise<RecentToken[]> {
  try {
    const data = await AsyncStorage.getItem(RECENTLY_USED_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn("[TokenSelect] Failed to load recently used:", err);
  }
  return [];
}

async function saveRecentlyUsed(tokens: RecentToken[]): Promise<void> {
  try {
    await AsyncStorage.setItem(RECENTLY_USED_KEY, JSON.stringify(tokens));
  } catch (err) {
    console.warn("[TokenSelect] Failed to save recently used:", err);
  }
}

async function addToRecentlyUsed(token: TokenInfo, existing: RecentToken[]): Promise<RecentToken[]> {
  const newEntry: RecentToken = {
    mint: token.mint,
    symbol: token.symbol,
    name: token.name,
    logoURI: token.logoURI,
    decimals: token.decimals,
  };
  const filtered = existing.filter(t => t.mint !== token.mint);
  const updated = [newEntry, ...filtered].slice(0, MAX_RECENTLY_USED);
  await saveRecentlyUsed(updated);
  return updated;
}

async function clearRecentlyUsed(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RECENTLY_USED_KEY);
  } catch (err) {
    console.warn("[TokenSelect] Failed to clear recently used:", err);
  }
}

export default function TokenSelectScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<TokenSelectRouteProp>();
  const { activeWallet } = useWallet();

  const { mode, onSelect, excludeMint } = route.params;
  const solanaAddress = activeWallet?.addresses?.solana;
  const { assets: solanaAssets } = useSolanaPortfolio(solanaAddress);

  const [search, setSearch] = useState("");
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [recentlyUsed, setRecentlyUsed] = useState<RecentToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [customToken, setCustomToken] = useState<TokenInfo | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    loadRecentlyUsed().then(setRecentlyUsed);
    setTokens(getPopularTokens());
  }, []);

  const isMintSearch = useMemo(() => isLikelySolanaMint(search), [search]);

  const handleSearch = useCallback(async (query: string) => {
    setSearch(query);
    setCustomToken(null);
    setCustomError(null);

    if (isLikelySolanaMint(query)) {
      setCustomLoading(true);
      try {
        const url = new URL(`/api/swap/solana/token/${query.trim()}`, getApiUrl());
        const resp = await fetch(url.toString());
        const data = await resp.json();
        if (resp.ok && data.ok !== false) {
          setCustomToken({
            mint: data.mint,
            symbol: data.symbol,
            name: data.name,
            decimals: data.decimals,
            logoURI: data.logoURI,
          });
        } else {
          setCustomError(data.error || "Token not found");
        }
      } catch (err: any) {
        setCustomError(err.message || "Failed to fetch token");
      } finally {
        setCustomLoading(false);
      }
    } else if (query.trim()) {
      const results = await searchTokens(query);
      setTokens(results);
    } else {
      setTokens(getPopularTokens());
    }
  }, []);

  const handleSelectToken = useCallback(async (token: TokenInfo) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = await addToRecentlyUsed(token, recentlyUsed);
    setRecentlyUsed(updated);
    onSelect(token);
    navigation.goBack();
  }, [recentlyUsed, onSelect, navigation]);

  const handleClearRecent = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await clearRecentlyUsed();
    setRecentlyUsed([]);
  }, []);

  const getTokenBalance = useCallback((mint: string): number => {
    if (!solanaAssets) return 0;
    const asset = solanaAssets.find(a => a.mint === mint);
    const bal = asset?.balance;
    return typeof bal === "number" ? bal : parseFloat(bal || "0") || 0;
  }, [solanaAssets]);

  const getTokenUsdValue = useCallback((mint: string): number => {
    if (!solanaAssets) return 0;
    const asset = solanaAssets.find(a => a.mint === mint);
    const bal = typeof asset?.balance === "number" ? asset.balance : parseFloat(asset?.balance || "0") || 0;
    const price = asset?.priceUsd || 0;
    return bal * price;
  }, [solanaAssets]);

  const filteredTokens = useMemo(() => {
    if (excludeMint) {
      return tokens.filter(t => t.mint !== excludeMint);
    }
    return tokens;
  }, [tokens, excludeMint]);

  const filteredRecent = useMemo(() => {
    if (excludeMint) {
      return recentlyUsed.filter(t => t.mint !== excludeMint);
    }
    return recentlyUsed;
  }, [recentlyUsed, excludeMint]);

  const renderTokenItem = useCallback(({ item }: { item: TokenInfo }) => {
    const balance = getTokenBalance(item.mint);
    const usdValue = getTokenUsdValue(item.mint);

    return (
      <Pressable
        style={({ pressed }) => [
          styles.tokenRow,
          { backgroundColor: pressed ? theme.backgroundSecondary : "transparent" },
        ]}
        onPress={() => handleSelectToken(item)}
      >
        <View style={styles.tokenLeft}>
          {item.logoURI ? (
            <View style={[styles.tokenLogo, { backgroundColor: theme.backgroundSecondary }]}>
              <ThemedText style={styles.tokenLogoFallback}>
                {item.symbol.slice(0, 2).toUpperCase()}
              </ThemedText>
            </View>
          ) : (
            <View style={[styles.tokenLogo, { backgroundColor: theme.backgroundSecondary }]}>
              <ThemedText style={styles.tokenLogoFallback}>
                {item.symbol.slice(0, 2).toUpperCase()}
              </ThemedText>
            </View>
          )}
          <View style={styles.tokenInfo}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {item.symbol}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Solana
            </ThemedText>
          </View>
        </View>
        <View style={styles.tokenRight}>
          <ThemedText type="body" style={{ fontWeight: "500", textAlign: "right" }}>
            {balance > 0 ? balance.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "0"}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "right" }}>
            ${usdValue.toFixed(2)}
          </ThemedText>
        </View>
      </Pressable>
    );
  }, [theme, handleSelectToken, getTokenBalance, getTokenUsdValue]);

  const renderRecentChip = useCallback((token: RecentToken) => (
    <Pressable
      key={token.mint}
      style={({ pressed }) => [
        styles.recentChip,
        { 
          backgroundColor: pressed ? theme.backgroundSecondary : theme.backgroundDefault,
          borderColor: theme.border,
        },
      ]}
      onPress={() => handleSelectToken(token as TokenInfo)}
    >
      <View style={[styles.chipLogo, { backgroundColor: theme.backgroundSecondary }]}>
        <ThemedText style={styles.chipLogoText}>
          {token.symbol.slice(0, 2).toUpperCase()}
        </ThemedText>
      </View>
      <ThemedText type="caption" style={{ fontWeight: "500" }}>
        {token.symbol}
      </ThemedText>
    </Pressable>
  ), [theme, handleSelectToken]);

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable style={styles.backButton} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={24} color={theme.text} />
        </Pressable>
        <ThemedText type="body" style={styles.headerTitle}>
          {mode === "input" ? "You Pay" : "You Receive"}
        </ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={[styles.searchContainer, { backgroundColor: theme.backgroundSecondary }]}>
        <Feather name="search" size={18} color={theme.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Search token"
          placeholderTextColor={theme.textSecondary}
          value={search}
          onChangeText={handleSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <Pressable onPress={() => handleSearch("")}>
            <Feather name="x" size={18} color={theme.textSecondary} />
          </Pressable>
        )}
      </View>

      {filteredRecent.length > 0 && !isMintSearch && (
        <View style={styles.recentSection}>
          <View style={styles.recentHeader}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Recently used
            </ThemedText>
            <Pressable onPress={handleClearRecent}>
              <ThemedText type="caption" style={{ color: theme.accent }}>
                Clear all
              </ThemedText>
            </Pressable>
          </View>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentChips}
          >
            {filteredRecent.map(renderRecentChip)}
          </ScrollView>
        </View>
      )}

      {isMintSearch ? (
        <View style={styles.customTokenSection}>
          {customLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={theme.accent} />
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginLeft: Spacing.sm }}>
                Looking up token...
              </ThemedText>
            </View>
          ) : customError ? (
            <View style={styles.errorContainer}>
              <Feather name="alert-circle" size={16} color={theme.textSecondary} />
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginLeft: Spacing.sm }}>
                {customError}
              </ThemedText>
            </View>
          ) : customToken ? (
            <Pressable
              style={({ pressed }) => [
                styles.tokenRow,
                { backgroundColor: pressed ? theme.backgroundSecondary : "transparent" },
              ]}
              onPress={() => handleSelectToken(customToken)}
            >
              <View style={styles.tokenLeft}>
                <View style={[styles.tokenLogo, { backgroundColor: theme.backgroundSecondary }]}>
                  <ThemedText style={styles.tokenLogoFallback}>
                    {customToken.symbol.slice(0, 2).toUpperCase()}
                  </ThemedText>
                </View>
                <View style={styles.tokenInfo}>
                  <View style={styles.symbolRow}>
                    <ThemedText type="body" style={{ fontWeight: "600" }}>
                      {customToken.symbol}
                    </ThemedText>
                    <View style={[styles.unverifiedBadge, { backgroundColor: "#F59E0B20" }]}>
                      <ThemedText style={styles.unverifiedText}>Unverified</ThemedText>
                    </View>
                  </View>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {customToken.name}
                  </ThemedText>
                </View>
              </View>
              <View style={styles.tokenRight}>
                <ThemedText type="body" style={{ fontWeight: "500", textAlign: "right" }}>
                  {getTokenBalance(customToken.mint).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "right" }}>
                  ${getTokenUsdValue(customToken.mint).toFixed(2)}
                </ThemedText>
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={filteredTokens}
          renderItem={renderTokenItem}
          keyExtractor={(item) => item.mint}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Spacing.lg }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  backButton: {
    padding: Spacing.xs,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontWeight: "600",
  },
  headerSpacer: {
    width: 32,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.xs,
  },
  recentSection: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  recentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  recentChips: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  recentChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  chipLogo: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  chipLogoText: {
    fontSize: 8,
    fontWeight: "600",
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  tokenRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
  },
  tokenLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  tokenLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  tokenLogoFallback: {
    fontSize: 14,
    fontWeight: "600",
  },
  tokenInfo: {
    marginLeft: Spacing.sm,
    flex: 1,
  },
  tokenRight: {
    alignItems: "flex-end",
  },
  symbolRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  unverifiedBadge: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  unverifiedText: {
    fontSize: 10,
    color: "#F59E0B",
    fontWeight: "500",
  },
  customTokenSection: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.xl,
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.xl,
  },
});
