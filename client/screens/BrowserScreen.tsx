import { View, StyleSheet, ScrollView, Pressable, TextInput, Image, Alert } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useState, useCallback } from "react";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeOut, Layout } from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { Badge } from "@/components/Badge";
import { useWallet } from "@/lib/wallet-context";
import { useWalletConnect } from "@/lib/walletconnect/context";
import { useBrowserStore, getFaviconUrl, normalizeUrl, RecentSite } from "@/store/browserStore";
import { POPULAR_DAPPS, DApp, searchDApps } from "@/data/dapps";
import { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function BrowserScreen() {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { activeWallet } = useWallet();
  const { sessions, disconnect: wcDisconnectSession, isInitialized } = useWalletConnect();
  const { recents, addRecent, removeRecent, clearRecents, isLoading: recentsLoading } = useBrowserStore();
  const navigation = useNavigation<NavigationProp>();
  
  const [searchQuery, setSearchQuery] = useState("");

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
      "Disconnect Session",
      `Are you sure you want to disconnect from ${name}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              await wcDisconnectSession(topic);
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (error: any) {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert("Error", error.message || "Failed to disconnect");
            }
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
    Alert.alert(
      "Clear History",
      "Are you sure you want to clear your browsing history?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            await clearRecents();
          },
        },
      ]
    );
  }, [clearRecents]);

  const handleRemoveRecent = useCallback(
    async (url: string) => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await removeRecent(url);
    },
    [removeRecent]
  );

  const filteredDApps = searchQuery.trim()
    ? searchDApps(searchQuery)
    : POPULAR_DAPPS;

  const renderSessionCard = useCallback(
    (session: typeof sessions[0]) => {
      const domain = session.peerMeta.url ? new URL(session.peerMeta.url).hostname : "Unknown";
      const chains = session.chains?.map((c) => {
        if (c.startsWith("eip155:1")) return "Ethereum";
        if (c.startsWith("eip155:137")) return "Polygon";
        if (c.startsWith("eip155:56")) return "BNB";
        if (c.startsWith("solana:")) return "Solana";
        return c;
      }).join(", ") || "Multi-chain";

      return (
        <Animated.View
          key={session.topic}
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          layout={Layout.springify()}
        >
          <Pressable
            style={[styles.sessionCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.success }]}
            onPress={() => handleDisconnectSession(session.topic, session.peerMeta.name)}
            testID={`session-${session.topic}`}
          >
            <View style={styles.sessionCardContent}>
              {session.peerMeta.icons?.[0] ? (
                <Image
                  source={{ uri: session.peerMeta.icons[0] }}
                  style={styles.sessionIcon}
                  defaultSource={{ uri: getFaviconUrl(session.peerMeta.url || "") }}
                />
              ) : (
                <View style={[styles.sessionIconFallback, { backgroundColor: theme.accent + "20" }]}>
                  <ThemedText type="h4" style={{ color: theme.accent }}>
                    {session.peerMeta.name?.charAt(0) || "?"}
                  </ThemedText>
                </View>
              )}
              <View style={styles.sessionInfo}>
                <ThemedText type="body" style={{ fontWeight: "600" }} numberOfLines={1}>
                  {session.peerMeta.name}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
                  {domain}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {chains}
                </ThemedText>
              </View>
              <View style={styles.sessionStatus}>
                <View style={[styles.statusDot, { backgroundColor: theme.success }]} />
                <ThemedText type="caption" style={{ color: theme.success }}>
                  Connected
                </ThemedText>
              </View>
            </View>
          </Pressable>
        </Animated.View>
      );
    },
    [theme, handleDisconnectSession]
  );

  const renderRecentItem = useCallback(
    (recent: RecentSite) => (
      <Pressable
        key={recent.url}
        style={[styles.recentItem, { backgroundColor: theme.backgroundDefault }]}
        onPress={() => handleOpenDApp(recent.url, recent.title)}
        onLongPress={() => handleRemoveRecent(recent.url)}
        testID={`recent-${recent.url}`}
      >
        <Image
          source={{ uri: recent.favicon || getFaviconUrl(recent.url) }}
          style={styles.recentFavicon}
          defaultSource={{ uri: getFaviconUrl(recent.url) }}
        />
        <ThemedText type="caption" numberOfLines={1} style={styles.recentTitle}>
          {recent.title || new URL(recent.url).hostname}
        </ThemedText>
      </Pressable>
    ),
    [theme, handleOpenDApp, handleRemoveRecent]
  );

  const renderDAppCard = useCallback(
    (dapp: DApp) => (
      <Pressable
        key={dapp.id}
        style={[styles.dappCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}
        onPress={() => handleOpenDApp(dapp.url, dapp.name)}
        testID={`dapp-${dapp.id}`}
      >
        {dapp.iconUrl ? (
          <Image
            source={{ uri: dapp.iconUrl }}
            style={styles.dappFavicon}
            defaultSource={{ uri: getFaviconUrl(dapp.url) }}
          />
        ) : (
          <View style={[styles.dappIconFallback, { backgroundColor: theme.accent + "15" }]}>
            <ThemedText type="h4" style={{ color: theme.accent }}>
              {dapp.name.charAt(0)}
            </ThemedText>
          </View>
        )}
        <ThemedText type="body" style={styles.dappName} numberOfLines={1}>
          {dapp.name}
        </ThemedText>
        <Badge label={dapp.category} variant="neutral" />
      </Pressable>
    ),
    [theme, handleOpenDApp]
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.xl,
        paddingBottom: tabBarHeight + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.searchContainer, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
        <Feather name="search" size={20} color={theme.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Search or enter dApp URL"
          placeholderTextColor={theme.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          testID="browser-search-input"
        />
        {searchQuery.length > 0 ? (
          <Pressable onPress={() => setSearchQuery("")} testID="clear-search">
            <Feather name="x" size={20} color={theme.textSecondary} />
          </Pressable>
        ) : (
          <Pressable onPress={handleOpenWalletConnect} testID="qr-scan-button">
            <Feather name="maximize" size={20} color={theme.textSecondary} />
          </Pressable>
        )}
      </View>

      <View style={[styles.securityBanner, { backgroundColor: theme.success + "10", borderColor: theme.success + "30" }]}>
        <Feather name="shield" size={16} color={theme.success} />
        <ThemedText type="caption" style={{ color: theme.success, flex: 1 }}>
          Wallet Firewall Active — risky sites and transactions are screened.
        </ThemedText>
      </View>

      {sessions.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="h4">Connected Sessions</ThemedText>
            <Badge label={`${sessions.length} Active`} variant="success" />
          </View>
          {sessions.map(renderSessionCard)}
        </View>
      ) : null}

      {recents.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="h4">Recent</ThemedText>
            <Pressable onPress={handleClearRecents} testID="clear-recents">
              <Feather name="trash-2" size={18} color={theme.textSecondary} />
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentsRow}
          >
            {recents.slice(0, 10).map(renderRecentItem)}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.section}>
        <ThemedText type="h4" style={styles.sectionTitle}>
          {searchQuery.trim() ? "Search Results" : "Popular dApps"}
        </ThemedText>
        {filteredDApps.length > 0 ? (
          <View style={styles.dappGrid}>{filteredDApps.map(renderDAppCard)}</View>
        ) : (
          <View style={[styles.emptyState, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="search" size={32} color={theme.textSecondary} />
            <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: Spacing.md }}>
              No dApps found
            </ThemedText>
          </View>
        )}
      </View>

      <Pressable
        style={[styles.wcCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}
        onPress={handleOpenWalletConnect}
        testID="walletconnect-card"
      >
        <View style={[styles.wcIcon, { backgroundColor: theme.accent + "20" }]}>
          <Feather name="link" size={24} color={theme.accent} />
        </View>
        <View style={styles.wcContent}>
          <ThemedText type="body" style={{ fontWeight: "600" }}>
            WalletConnect
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Scan QR code to connect to any compatible dApp
          </ThemedText>
        </View>
        <Feather name="chevron-right" size={20} color={theme.textSecondary} />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  securityBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    gap: Spacing.sm,
    marginBottom: Spacing["2xl"],
  },
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    marginBottom: Spacing.lg,
  },
  sessionCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  sessionCardContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  sessionIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
  },
  sessionIconFallback: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionInfo: {
    flex: 1,
    gap: 2,
  },
  sessionStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  recentsRow: {
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  recentItem: {
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    width: 80,
    gap: Spacing.sm,
  },
  recentFavicon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
  },
  recentTitle: {
    textAlign: "center",
    maxWidth: 72,
  },
  dappGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  dappCard: {
    width: "31%",
    flexGrow: 1,
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: "center",
    gap: Spacing.sm,
  },
  dappFavicon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  dappIconFallback: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xs,
  },
  dappName: {
    fontWeight: "600",
    textAlign: "center",
  },
  emptyState: {
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  wcCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.md,
  },
  wcIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  wcContent: {
    flex: 1,
    gap: Spacing.xs,
  },
});
