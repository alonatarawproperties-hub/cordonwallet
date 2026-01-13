import { useState, useRef, useEffect } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert, Switch } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ListRow } from "@/components/ListRow";
import { useWallet } from "@/lib/wallet-context";
import { useDemo } from "@/lib/demo/context";
import { useDevSettings } from "@/context/DevSettingsContext";
import { NETWORKS } from "@/lib/types";
import { getChainById } from "@/lib/blockchain/chains";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export default function SettingsScreen() {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { activeWallet, logout, selectedNetwork } = useWallet();
  const { isDemoMode, toggleDemoMode } = useDemo();
  const { settings, updateSetting, loadSettings } = useDevSettings();
  const [showDebug, setShowDebug] = useState(false);
  const tapCountRef = useRef(0);
  const lastTapRef = useRef(0);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleVersionTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 500) {
      tapCountRef.current += 1;
      if (tapCountRef.current >= 5) {
        setShowDebug(!showDebug);
        tapCountRef.current = 0;
      }
    } else {
      tapCountRef.current = 1;
    }
    lastTapRef.current = now;
  };

  const chainId = NETWORKS[selectedNetwork].chainId;
  const chainConfig = getChainById(chainId);

  const handleLogout = () => {
    Alert.alert(
      "Remove Wallet",
      "This will remove all wallet data from this device. Make sure you have backed up your seed phrase.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Remove", 
          style: "destructive",
          onPress: async () => {
            await logout();
            navigation.reset({
              index: 0,
              routes: [{ name: "Welcome" }],
            });
          }
        },
      ]
    );
  };

  const securityItems = [
    { title: "Wallet Firewall", subtitle: "Protect your transactions", icon: "shield", onPress: () => navigation.navigate("PolicySettings") },
    { title: "Biometric Unlock", subtitle: "Face ID / Fingerprint", icon: "smartphone", onPress: () => {} },
    { title: "Change PIN", subtitle: "Update your security PIN", icon: "lock", onPress: () => {} },
  ];

  const walletItems = [
    { title: "Manage Wallets", subtitle: `${activeWallet?.name || "No wallet"}`, icon: "credit-card", onPress: () => navigation.navigate("WalletManager") },
    { title: "Token Approvals", subtitle: "Manage contract approvals", icon: "check-circle", onPress: () => navigation.navigate("Approvals") },
    { title: "WalletConnect", subtitle: "Connect to dApps", icon: "link", onPress: () => navigation.navigate("WalletConnect") },
    { title: "Networks", subtitle: "Ethereum, Polygon, BSC", icon: "globe", onPress: () => {} },
  ];

  const aboutItems = [
    { title: "Help & Support", subtitle: "Get help with Cordon", icon: "help-circle", onPress: () => {} },
    { title: "Terms of Service", subtitle: "Legal information", icon: "file-text", onPress: () => {} },
    { title: "Version", subtitle: "1.0.0", icon: "info", onPress: handleVersionTap },
  ];

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
      <View style={styles.section}>
        <ThemedText type="small" style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          Security
        </ThemedText>
        <View style={styles.sectionContent}>
          {securityItems.map((item, index) => (
            <ListRow
              key={item.title}
              title={item.title}
              subtitle={item.subtitle}
              leftIcon={
                <View style={[styles.iconContainer, { backgroundColor: theme.accent + "20" }]}>
                  <Feather name={item.icon as any} size={18} color={theme.accent} />
                </View>
              }
              showChevron
              onPress={item.onPress}
              style={{
                ...(index === 0 ? styles.firstItem : {}),
                ...(index === securityItems.length - 1 ? styles.lastItem : {}),
                ...(index > 0 ? { marginTop: 1 } : {}),
              }}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <ThemedText type="small" style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          Wallet
        </ThemedText>
        <View style={styles.sectionContent}>
          {walletItems.map((item, index) => (
            <ListRow
              key={item.title}
              title={item.title}
              subtitle={item.subtitle}
              leftIcon={
                <View style={[styles.iconContainer, { backgroundColor: theme.success + "20" }]}>
                  <Feather name={item.icon as any} size={18} color={theme.success} />
                </View>
              }
              showChevron
              onPress={item.onPress}
              style={{
                ...(index === 0 ? styles.firstItem : {}),
                ...(index === walletItems.length - 1 ? styles.lastItem : {}),
                ...(index > 0 ? { marginTop: 1 } : {}),
              }}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <ThemedText type="small" style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          About
        </ThemedText>
        <View style={styles.sectionContent}>
          {aboutItems.map((item, index) => (
            <ListRow
              key={item.title}
              title={item.title}
              subtitle={item.subtitle}
              leftIcon={
                <View style={[styles.iconContainer, { backgroundColor: theme.textSecondary + "20" }]}>
                  <Feather name={item.icon as any} size={18} color={theme.textSecondary} />
                </View>
              }
              showChevron={item.title !== "Version"}
              onPress={item.onPress}
              style={{
                ...(index === 0 ? styles.firstItem : {}),
                ...(index === aboutItems.length - 1 ? styles.lastItem : {}),
                ...(index > 0 ? { marginTop: 1 } : {}),
              }}
            />
          ))}
        </View>
      </View>

      {showDebug ? (
        <View style={styles.section}>
          <ThemedText type="small" style={[styles.sectionTitle, { color: theme.accent }]}>
            Demo Mode
          </ThemedText>
          <View style={[styles.demoPanel, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.demoRow}>
              <View style={{ flex: 1 }}>
                <ThemedText type="body" style={{ fontWeight: "500" }}>Demo Mode</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  For website demo assets
                </ThemedText>
              </View>
              <Switch
                value={isDemoMode}
                onValueChange={toggleDemoMode}
                trackColor={{ false: theme.border, true: theme.accent }}
                thumbColor="#fff"
              />
            </View>
            {isDemoMode ? (
              <Pressable
                onPress={() => navigation.navigate("DemoFlow")}
                style={[styles.demoButton, { backgroundColor: theme.accent + "15" }]}
              >
                <Feather name="camera" size={18} color={theme.accent} />
                <ThemedText type="body" style={{ marginLeft: Spacing.sm, color: theme.accent, fontWeight: "500" }}>
                  Export Demo Assets
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {showDebug ? (
        <View style={styles.section}>
          <ThemedText type="small" style={[styles.sectionTitle, { color: theme.warning }]}>
            Developer Debug
          </ThemedText>
          <View style={[styles.debugPanel, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.debugRow}>
              <View style={{ flex: 1 }}>
                <ThemedText type="body" style={{ fontWeight: "500" }}>Simulate Cordon Browser</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  Force isCordonBrowser=true
                </ThemedText>
              </View>
              <Switch
                value={settings.simulateCordonBrowser}
                onValueChange={(val) => updateSetting("simulateCordonBrowser", val)}
                trackColor={{ false: theme.border, true: theme.warning }}
                thumbColor="#fff"
              />
            </View>
            <View style={[styles.debugRow, { borderTopWidth: 1, borderTopColor: theme.border, marginTop: Spacing.sm, paddingTop: Spacing.sm }]}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Chain ID</ThemedText>
              <ThemedText type="small" style={{ fontFamily: "monospace" }}>{chainId}</ThemedText>
            </View>
            <View style={[styles.debugRow, { borderTopWidth: 1, borderTopColor: theme.border }]}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Network</ThemedText>
              <ThemedText type="small">{chainConfig?.name || "Unknown"}</ThemedText>
            </View>
            <View style={[styles.debugRow, { borderTopWidth: 1, borderTopColor: theme.border }]}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>RPC Host</ThemedText>
              <ThemedText type="small" style={{ fontFamily: "monospace", fontSize: 10 }} numberOfLines={1}>
                {chainConfig ? new URL(chainConfig.rpcUrl).host : "N/A"}
              </ThemedText>
            </View>
            <View style={[styles.debugRow, { borderTopWidth: 1, borderTopColor: theme.border }]}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Testnet</ThemedText>
              <ThemedText type="small">{chainConfig?.isTestnet ? "Yes" : "No"}</ThemedText>
            </View>
            <View style={[styles.debugRow, { borderTopWidth: 1, borderTopColor: theme.border }]}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Explorer</ThemedText>
              <ThemedText type="small" style={{ fontFamily: "monospace", fontSize: 10 }} numberOfLines={1}>
                {chainConfig?.explorerBaseUrl || "N/A"}
              </ThemedText>
            </View>
          </View>
        </View>
      ) : null}

      <Pressable
        style={[styles.logoutButton, { backgroundColor: theme.danger + "15" }]}
        onPress={handleLogout}
      >
        <Feather name="log-out" size={20} color={theme.danger} />
        <ThemedText type="body" style={{ color: theme.danger, fontWeight: "600" }}>
          Remove Wallet
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    marginBottom: Spacing.sm,
    marginLeft: Spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionContent: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  firstItem: {
    borderTopLeftRadius: BorderRadius.md,
    borderTopRightRadius: BorderRadius.md,
  },
  lastItem: {
    borderBottomLeftRadius: BorderRadius.md,
    borderBottomRightRadius: BorderRadius.md,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
    marginTop: Spacing.xl,
  },
  debugPanel: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  debugRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  demoPanel: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  demoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  demoButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.md,
  },
});
