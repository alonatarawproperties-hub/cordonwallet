import { View, StyleSheet, ScrollView, Pressable, TextInput, Image } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useState } from "react";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { Badge } from "@/components/Badge";
import { useWallet } from "@/lib/wallet-context";

interface DApp {
  id: string;
  name: string;
  category: string;
  icon: string;
  url: string;
  connected?: boolean;
}

const POPULAR_DAPPS: DApp[] = [
  { id: "1", name: "Uniswap", category: "DEX", icon: "repeat", url: "https://app.uniswap.org" },
  { id: "2", name: "Aave", category: "Lending", icon: "trending-up", url: "https://app.aave.com" },
  { id: "3", name: "OpenSea", category: "NFT", icon: "image", url: "https://opensea.io" },
  { id: "4", name: "Curve", category: "DEX", icon: "activity", url: "https://curve.fi" },
  { id: "5", name: "Compound", category: "Lending", icon: "layers", url: "https://compound.finance" },
  { id: "6", name: "1inch", category: "Aggregator", icon: "shuffle", url: "https://1inch.io" },
];

const CONNECTED_SESSIONS: DApp[] = [
  { id: "c1", name: "Uniswap", category: "DEX", icon: "repeat", url: "https://app.uniswap.org", connected: true },
];

export default function BrowserScreen() {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { activeWallet } = useWallet();
  const [searchQuery, setSearchQuery] = useState("");

  const handleConnect = (dapp: DApp) => {
    console.log("Connecting to", dapp.name);
  };

  const handleDisconnect = (dapp: DApp) => {
    console.log("Disconnecting from", dapp.name);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.xl,
        paddingBottom: tabBarHeight + Spacing.xl,
        paddingHorizontal: Spacing.lg,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
    >
      <View style={[styles.searchContainer, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
        <Feather name="search" size={20} color={theme.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Search dApps or enter URL"
          placeholderTextColor={theme.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 ? (
          <Pressable onPress={() => setSearchQuery("")}>
            <Feather name="x" size={20} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {CONNECTED_SESSIONS.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText type="h4">Connected Sessions</ThemedText>
            <Badge label={`${CONNECTED_SESSIONS.length} Active`} variant="success" />
          </View>
          <View style={styles.dappGrid}>
            {CONNECTED_SESSIONS.map((dapp) => (
              <Pressable
                key={dapp.id}
                style={[styles.dappCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.success }]}
                onPress={() => handleDisconnect(dapp)}
              >
                <View style={[styles.dappIcon, { backgroundColor: theme.success + "20" }]}>
                  <Feather name={dapp.icon as any} size={24} color={theme.success} />
                </View>
                <ThemedText type="body" style={styles.dappName} numberOfLines={1}>
                  {dapp.name}
                </ThemedText>
                <View style={styles.connectedBadge}>
                  <View style={[styles.connectedDot, { backgroundColor: theme.success }]} />
                  <ThemedText type="caption" style={{ color: theme.success }}>
                    Connected
                  </ThemedText>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <ThemedText type="h4" style={styles.sectionTitle}>
          Popular dApps
        </ThemedText>
        <View style={styles.dappGrid}>
          {POPULAR_DAPPS.filter(d => !CONNECTED_SESSIONS.find(c => c.id === d.id)).map((dapp) => (
            <Pressable
              key={dapp.id}
              style={[styles.dappCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}
              onPress={() => handleConnect(dapp)}
            >
              <View style={[styles.dappIcon, { backgroundColor: theme.accent + "15" }]}>
                <Feather name={dapp.icon as any} size={24} color={theme.accent} />
              </View>
              <ThemedText type="body" style={styles.dappName} numberOfLines={1}>
                {dapp.name}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {dapp.category}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.infoCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={[styles.infoIcon, { backgroundColor: theme.accent + "20" }]}>
          <Feather name="link" size={20} color={theme.accent} />
        </View>
        <View style={styles.infoContent}>
          <ThemedText type="h4">WalletConnect</ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Scan a QR code to connect to any WalletConnect-compatible dApp
          </ThemedText>
        </View>
        <Feather name="chevron-right" size={20} color={theme.textSecondary} />
      </View>
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
    marginBottom: Spacing["2xl"],
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
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
  dappIcon: {
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
  connectedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  infoIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  infoContent: {
    flex: 1,
    gap: Spacing.xs,
  },
});
