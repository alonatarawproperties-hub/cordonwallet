import { View, StyleSheet, ScrollView, Pressable, TextInput, Image, Alert, Dimensions } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useState, useCallback, useMemo } from "react";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, FadeOut, Layout } from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { useWallet } from "@/lib/wallet-context";
import { useWalletConnect } from "@/lib/walletconnect/context";
import { useBrowserStore, getFaviconUrl, normalizeUrl, RecentSite } from "@/store/browserStore";
import { POPULAR_DAPPS, DApp, DAPP_CATEGORIES, getDAppsByCategory, searchDApps } from "@/data/dapps";
import { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = (SCREEN_WIDTH - Spacing.lg * 2 - Spacing.md * 2) / 3;

const FEATURED_DAPPS = ["jupiter", "uniswap", "magic-eden"];

export default function BrowserScreen() {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { activeWallet } = useWallet();
  const { sessions, disconnect: wcDisconnectSession } = useWalletConnect();
  const { recents, removeRecent, clearRecents } = useBrowserStore();
  const navigation = useNavigation<NavigationProp>();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const handleOpenDApp = useCallback(async (url: string, name?: string) => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const normalizedUrl = normalizeUrl(url);
      navigation.navigate("BrowserWebView", { url: normalizedUrl, title: name });
    } catch (error: any) {
      Alert.alert("Invalid URL", error.message || "Could not open this URL");
    }
  }, [navigation]);

  const handleSearch = useCallback(() => {
    if (searchQuery.trim()) {
      handleOpenDApp(searchQuery.trim());
      setSearchQuery("");
    }
  }, [searchQuery, handleOpenDApp]);

  const handleDisconnectSession = useCallback(async (topic: string, name: string) => {
    Alert.alert(
      "Disconnect",
      `Disconnect from ${name}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            await wcDisconnectSession(topic);
          },
        },
      ]
    );
  }, [wcDisconnectSession]);

  const handleOpenWalletConnect = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("WCScanner");
  }, [navigation]);

  const handleClearRecents = useCallback(() => {
    Alert.alert("Clear History", "Clear all browsing history?", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => clearRecents() },
    ]);
  }, [clearRecents]);

  const filteredDApps = useMemo(() => {
    if (searchQuery.trim()) return searchDApps(searchQuery);
    return getDAppsByCategory(activeCategory);
  }, [searchQuery, activeCategory]);

  const featuredDApps = useMemo(() => {
    return POPULAR_DAPPS.filter(d => FEATURED_DAPPS.includes(d.id));
  }, []);

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "DEX": return "#3B82F6";
      case "Lending": return "#10B981";
      case "NFT": return "#8B5CF6";
      case "Aggregator": return "#F59E0B";
      case "Bridge": return "#EC4899";
      case "Gaming": return "#EF4444";
      default: return theme.accent;
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.md,
        paddingBottom: tabBarHeight + Spacing["2xl"],
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.searchSection}>
        <View style={[styles.searchBar, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="search" size={18} color={theme.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search dApps or enter URL"
            placeholderTextColor={theme.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
          />
          {searchQuery.length > 0 ? (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <Feather name="x-circle" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        <Pressable 
          style={[styles.scanButton, { backgroundColor: theme.accent }]}
          onPress={handleOpenWalletConnect}
        >
          <Feather name="maximize" size={20} color="#FFFFFF" />
        </Pressable>
      </View>

      {sessions.length > 0 ? (
        <View style={styles.sessionsSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sessionsScroll}>
            {sessions.map((session) => (
              <Pressable
                key={session.topic}
                style={[styles.sessionChip, { backgroundColor: theme.success + "15" }]}
                onPress={() => handleDisconnectSession(session.topic, session.peerMeta.name)}
              >
                <View style={[styles.sessionDot, { backgroundColor: theme.success }]} />
                <ThemedText type="caption" style={{ color: theme.success, fontWeight: "600" }} numberOfLines={1}>
                  {session.peerMeta.name}
                </ThemedText>
                <Feather name="x" size={14} color={theme.success} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {!searchQuery.trim() ? (
        <View style={styles.featuredSection}>
          <ThemedText type="body" style={[styles.sectionTitle, { paddingHorizontal: Spacing.lg }]}>
            Featured
          </ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.featuredScroll}>
            {featuredDApps.map((dapp, index) => (
              <Pressable
                key={dapp.id}
                style={styles.featuredCard}
                onPress={() => handleOpenDApp(dapp.url, dapp.name)}
              >
                <LinearGradient
                  colors={[getCategoryColor(dapp.category) + "40", getCategoryColor(dapp.category) + "10"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.featuredGradient, { borderColor: getCategoryColor(dapp.category) + "30" }]}
                >
                  <Image
                    source={{ uri: dapp.iconUrl }}
                    style={styles.featuredIcon}
                    defaultSource={{ uri: getFaviconUrl(dapp.url) }}
                  />
                  <View style={styles.featuredInfo}>
                    <ThemedText type="body" style={{ fontWeight: "700" }}>
                      {dapp.name}
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
                      {dapp.description}
                    </ThemedText>
                  </View>
                  <View style={[styles.featuredBadge, { backgroundColor: getCategoryColor(dapp.category) + "25" }]}>
                    <ThemedText style={{ fontSize: 10, color: getCategoryColor(dapp.category), fontWeight: "600" }}>
                      {dapp.category}
                    </ThemedText>
                  </View>
                </LinearGradient>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {recents.length > 0 && !searchQuery.trim() ? (
        <View style={styles.section}>
          <View style={[styles.sectionHeader, { paddingHorizontal: Spacing.lg }]}>
            <ThemedText type="body" style={styles.sectionTitle}>Recent</ThemedText>
            <Pressable onPress={handleClearRecents} hitSlop={8}>
              <ThemedText type="caption" style={{ color: theme.accent }}>Clear</ThemedText>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentsScroll}>
            {recents.slice(0, 8).map((recent) => (
              <Pressable
                key={recent.url}
                style={[styles.recentCard, { backgroundColor: theme.backgroundDefault }]}
                onPress={() => handleOpenDApp(recent.url, recent.title)}
              >
                <Image
                  source={{ uri: recent.favicon || getFaviconUrl(recent.url) }}
                  style={styles.recentIcon}
                />
                <ThemedText type="caption" numberOfLines={1} style={{ maxWidth: 56, textAlign: "center" }}>
                  {recent.title || new URL(recent.url).hostname.replace("www.", "").split(".")[0]}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.section}>
        {!searchQuery.trim() ? (
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false} 
            contentContainerStyle={styles.categoriesScroll}
          >
            {DAPP_CATEGORIES.map((cat) => (
              <Pressable
                key={cat.id}
                style={[
                  styles.categoryChip,
                  { 
                    backgroundColor: activeCategory === cat.id ? theme.accent : theme.backgroundDefault,
                  }
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setActiveCategory(cat.id);
                }}
              >
                <ThemedText 
                  type="caption" 
                  style={{ 
                    color: activeCategory === cat.id ? "#FFFFFF" : theme.textSecondary,
                    fontWeight: activeCategory === cat.id ? "600" : "500",
                  }}
                >
                  {cat.label}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.dappGrid}>
          {filteredDApps.map((dapp) => (
            <Pressable
              key={dapp.id}
              style={[styles.dappCard, { backgroundColor: theme.backgroundDefault }]}
              onPress={() => handleOpenDApp(dapp.url, dapp.name)}
            >
              {dapp.iconUrl ? (
                <Image source={{ uri: dapp.iconUrl }} style={styles.dappIcon} />
              ) : (
                <View style={[styles.dappIconFallback, { backgroundColor: getCategoryColor(dapp.category) + "20" }]}>
                  <ThemedText type="h3" style={{ color: getCategoryColor(dapp.category) }}>
                    {dapp.name.charAt(0)}
                  </ThemedText>
                </View>
              )}
              <ThemedText type="body" style={styles.dappName} numberOfLines={1}>
                {dapp.name}
              </ThemedText>
              <View style={[styles.categoryDot, { backgroundColor: getCategoryColor(dapp.category) }]} />
            </Pressable>
          ))}
        </View>

        {filteredDApps.length === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="search" size={40} color={theme.textSecondary} />
            <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: Spacing.md }}>
              No dApps found
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={[styles.wcSection, { marginHorizontal: Spacing.lg }]}>
        <Pressable
          style={[styles.wcCard, { backgroundColor: theme.backgroundDefault }]}
          onPress={handleOpenWalletConnect}
        >
          <LinearGradient
            colors={[theme.accent + "20", theme.accent + "05"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.wcGradient}
          >
            <View style={[styles.wcIconContainer, { backgroundColor: theme.accent + "25" }]}>
              <Feather name="link-2" size={22} color={theme.accent} />
            </View>
            <View style={styles.wcInfo}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                WalletConnect
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Scan to connect any dApp
              </ThemedText>
            </View>
            <View style={[styles.wcArrow, { backgroundColor: theme.accent + "15" }]}>
              <Feather name="arrow-right" size={16} color={theme.accent} />
            </View>
          </LinearGradient>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  searchSection: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.full,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  scanButton: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionsSection: {
    marginBottom: Spacing.lg,
  },
  sessionsScroll: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  sessionChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    gap: 6,
    maxWidth: 160,
  },
  sessionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  featuredSection: {
    marginBottom: Spacing.xl,
  },
  featuredScroll: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  featuredCard: {
    width: 220,
  },
  featuredGradient: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    gap: Spacing.md,
  },
  featuredIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
  },
  featuredInfo: {
    gap: 4,
  },
  featuredBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.xs,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    fontWeight: "600",
    marginBottom: Spacing.md,
  },
  recentsScroll: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  recentCard: {
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
    width: 72,
  },
  recentIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
  },
  categoriesScroll: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  categoryChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
  },
  dappGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  dappCard: {
    width: CARD_WIDTH,
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    gap: Spacing.sm,
  },
  dappIcon: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.md,
  },
  dappIconFallback: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  dappName: {
    fontWeight: "600",
    fontSize: 13,
    textAlign: "center",
  },
  categoryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  emptyState: {
    marginHorizontal: Spacing.lg,
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  wcSection: {
    marginTop: Spacing.md,
  },
  wcCard: {
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
  },
  wcGradient: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  wcIconContainer: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  wcInfo: {
    flex: 1,
    gap: 2,
  },
  wcArrow: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
