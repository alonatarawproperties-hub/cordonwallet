import { useState, useRef, useEffect, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert, Switch, Platform } from "react-native";
import { Image } from "expo-image";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ListRow } from "@/components/ListRow";
import { PinInputModal } from "@/components/PinInputModal";
import { useWallet } from "@/lib/wallet-context";
import { useDemo } from "@/lib/demo/context";
import { useDevSettings } from "@/context/DevSettingsContext";
import { NETWORKS } from "@/lib/types";
import { getChainById } from "@/lib/blockchain/chains";
import { FEATURES } from "@/config/features";
import { hasBiometricPinEnabled, isBiometricAvailable, savePinForBiometrics, disableBiometrics, verifyPinFast, changePin, getPinWithBiometrics } from "@/lib/wallet-engine";
import * as WebBrowser from "expo-web-browser";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export default function SettingsScreen() {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { activeWallet, logout, selectedNetwork } = useWallet();
  const { isDemoMode, toggleDemoMode } = useDemo();
  const { settings, updateSetting, loadSettings } = useDevSettings();
  const [showDebug, setShowDebug] = useState(false);
  const [showNetworks, setShowNetworks] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [isTogglingBiometric, setIsTogglingBiometric] = useState(false);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinModalStep, setPinModalStep] = useState<"current" | "new" | "confirm">("current");
  const [pinModalError, setPinModalError] = useState<string | null>(null);
  const [pinModalLoading, setPinModalLoading] = useState(false);
  const [currentPinValue, setCurrentPinValue] = useState("");
  const [newPinValue, setNewPinValue] = useState("");
  const tapCountRef = useRef(0);
  const lastTapRef = useRef(0);

  const allNetworks = [
    { name: "Ethereum", symbol: "ETH", color: "#627EEA", logoUrl: "https://assets.coingecko.com/coins/images/279/small/ethereum.png", isEvm: true },
    { name: "Polygon", symbol: "POL", color: "#8247E5", logoUrl: "https://coin-images.coingecko.com/coins/images/32440/small/polygon.png", isEvm: true },
    { name: "BNB Chain", symbol: "BNB", color: "#F3BA2F", logoUrl: "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png", isEvm: true },
    { name: "Arbitrum", symbol: "ETH", color: "#12AAFF", logoUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png", isEvm: true },
    { name: "Base", symbol: "ETH", color: "#0052FF", logoUrl: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png", isEvm: true },
    { name: "Solana", symbol: "SOL", color: "#9945FF", logoUrl: "https://assets.coingecko.com/coins/images/4128/small/solana.png", isEvm: false },
  ];
  
  const supportedNetworks = allNetworks.filter(n => 
    (FEATURES.EVM_ENABLED || !n.isEvm) && (FEATURES.SOLANA_ENABLED || n.isEvm)
  );

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const checkBiometricStatus = useCallback(async () => {
    const available = await isBiometricAvailable();
    setBiometricAvailable(available);
    if (available) {
      const enabled = await hasBiometricPinEnabled();
      setBiometricEnabled(enabled);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      checkBiometricStatus();
    }, [checkBiometricStatus])
  );

  const handleBiometricToggle = async () => {
    if (Platform.OS === "web") {
      Alert.alert("Not Available", "Biometric unlock is only available on mobile devices.");
      return;
    }

    if (!biometricAvailable) {
      Alert.alert("Not Available", "Your device does not support biometric authentication.");
      return;
    }

    setIsTogglingBiometric(true);

    try {
      if (biometricEnabled) {
        const success = await disableBiometrics();
        if (success) {
          setBiometricEnabled(false);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert("Disabled", "Biometric unlock has been disabled.");
        }
      } else {
        Alert.prompt(
          "Enable Biometric Unlock",
          "Enter your PIN to enable Face ID / Fingerprint unlock",
          async (pin: string) => {
            if (!pin || pin.length !== 6) {
              Alert.alert("Invalid PIN", "Please enter your 6-digit PIN.");
              setIsTogglingBiometric(false);
              return;
            }

            const isValid = await verifyPin(pin);
            if (!isValid) {
              Alert.alert("Incorrect PIN", "The PIN you entered is incorrect.");
              setIsTogglingBiometric(false);
              return;
            }

            const success = await savePinForBiometrics(pin);
            if (success) {
              setBiometricEnabled(true);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert("Enabled", "Biometric unlock is now enabled. You can use Face ID or Fingerprint to unlock Cordon.");
            } else {
              Alert.alert(
                "Expo Go Limitation", 
                "Biometric unlock requires a TestFlight or production build. This feature will work once the app is published."
              );
            }
            setIsTogglingBiometric(false);
          },
          "secure-text",
          "",
          "number-pad"
        );
        return;
      }
    } catch (error) {
      Alert.alert("Error", "An error occurred. Please try again.");
    }

    setIsTogglingBiometric(false);
  };

  const handleChangePin = async () => {
    setPinModalError(null);
    setCurrentPinValue("");
    setNewPinValue("");

    // If biometrics enabled, use it to verify identity and skip current PIN step
    const hasBiometric = await hasBiometricPinEnabled();
    if (hasBiometric) {
      try {
        const storedPin = await getPinWithBiometrics();
        if (storedPin) {
          // Biometric verified - skip to new PIN entry
          setCurrentPinValue(storedPin);
          setPinModalStep("new");
          setPinModalVisible(true);
          return;
        }
      } catch {
        // Biometric failed, fall back to PIN entry
      }
    }

    // No biometrics or biometric failed - require current PIN
    setPinModalStep("current");
    setPinModalVisible(true);
  };

  const handlePinModalSubmit = async (pin: string) => {
    if (pinModalStep === "current") {
      setPinModalLoading(true);
      const isValid = await verifyPinFast(pin);
      setPinModalLoading(false);
      if (!isValid) {
        setPinModalError("Incorrect PIN. Please try again.");
        return;
      }
      setCurrentPinValue(pin);
      setPinModalError(null);
      setPinModalStep("new");
    } else if (pinModalStep === "new") {
      setNewPinValue(pin);
      setPinModalError(null);
      setPinModalStep("confirm");
    } else if (pinModalStep === "confirm") {
      if (pin !== newPinValue) {
        setPinModalError("PINs do not match. Please try again.");
        return;
      }

      setPinModalLoading(true);
      try {
        // Skip verification since we already verified the current PIN
        const success = await changePin(currentPinValue, newPinValue, true);
        setPinModalLoading(false);
        if (success) {
          setPinModalVisible(false);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert("Success", "Your PIN has been changed successfully.");
        } else {
          setPinModalError("Could not change PIN. Please try again.");
        }
      } catch (error: any) {
        setPinModalLoading(false);
        setPinModalError(error.message || "Could not change PIN.");
      }
    }
  };

  const handlePinModalCancel = () => {
    setPinModalVisible(false);
    setPinModalError(null);
    setPinModalLoading(false);
  };

  const getPinModalTitle = () => {
    switch (pinModalStep) {
      case "current": return "Change PIN";
      case "new": return "New PIN";
      case "confirm": return "Confirm PIN";
    }
  };

  const getPinModalMessage = () => {
    switch (pinModalStep) {
      case "current": return "Enter your current 6-digit PIN";
      case "new": return "Enter your new 6-digit PIN";
      case "confirm": return "Re-enter your new PIN to confirm";
    }
  };

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

  const getBiometricSubtitle = () => {
    if (Platform.OS === "web") return "Not available on web";
    if (!biometricAvailable) return "Not available";
    return biometricEnabled ? "Enabled" : "Disabled";
  };

  const securityItems = [
    { title: "Wallet Firewall", subtitle: "Protect your transactions", icon: "shield", onPress: () => navigation.navigate("PolicySettings") },
    { title: "Biometric Unlock", subtitle: getBiometricSubtitle(), icon: "smartphone", onPress: handleBiometricToggle, isBiometric: true },
    { title: "Change PIN", subtitle: "Update your security PIN", icon: "lock", onPress: handleChangePin },
  ];

  const walletItems = [
    { title: "Manage Wallets", subtitle: `${activeWallet?.name || "No wallet"}`, icon: "credit-card", onPress: () => navigation.navigate("WalletManager") },
    { title: "Token Approvals", subtitle: "Manage contract approvals", icon: "check-circle", onPress: () => navigation.navigate("Approvals") },
    { title: "WalletConnect", subtitle: "Connect to dApps", icon: "link", onPress: () => navigation.navigate("WalletConnect") },
    { title: "Networks", subtitle: supportedNetworks.map(n => n.symbol === "ETH" && n.name !== "Ethereum" ? n.name : n.symbol).join(", "), icon: "globe", onPress: () => setShowNetworks(!showNetworks), expandable: true },
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
        paddingBottom: insets.bottom + Spacing.xl,
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
            <Pressable
              key={item.title}
              style={[
                styles.networkRowItem,
                { backgroundColor: theme.backgroundDefault },
                index === 0 ? styles.firstItem : {},
                index === securityItems.length - 1 ? styles.lastItem : {},
                index > 0 ? { marginTop: 1 } : {},
              ]}
              onPress={item.onPress}
              disabled={item.isBiometric && isTogglingBiometric}
            >
              <View style={[styles.iconContainer, { backgroundColor: theme.accent + "20" }]}>
                <Feather name={item.icon as any} size={18} color={theme.accent} />
              </View>
              <View style={{ flex: 1, marginLeft: Spacing.md }}>
                <ThemedText type="body" style={{ fontWeight: "500" }}>{item.title}</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>{item.subtitle}</ThemedText>
              </View>
              {item.isBiometric && biometricAvailable ? (
                <Switch
                  value={biometricEnabled}
                  onValueChange={handleBiometricToggle}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor="#fff"
                  disabled={isTogglingBiometric}
                />
              ) : (
                <Feather name="chevron-right" size={18} color={theme.textSecondary} />
              )}
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <ThemedText type="small" style={[styles.sectionTitle, { color: theme.textSecondary }]}>
          Wallet
        </ThemedText>
        <View style={styles.sectionContent}>
          {walletItems.map((item, index) => (
            <View key={item.title}>
              <Pressable
                style={[
                  styles.networkRowItem,
                  { backgroundColor: theme.backgroundDefault },
                  index === 0 ? styles.firstItem : {},
                  index === walletItems.length - 1 && !(item.title === "Networks" && showNetworks) ? styles.lastItem : {},
                  index > 0 ? { marginTop: 1 } : {},
                ]}
                onPress={item.onPress}
              >
                <View style={[styles.iconContainer, { backgroundColor: theme.success + "20" }]}>
                  <Feather name={item.icon as any} size={18} color={theme.success} />
                </View>
                <View style={{ flex: 1, marginLeft: Spacing.md }}>
                  <ThemedText type="body" style={{ fontWeight: "500" }}>{item.title}</ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>{item.subtitle}</ThemedText>
                </View>
                <Feather 
                  name={item.title === "Networks" ? (showNetworks ? "chevron-up" : "chevron-down") : "chevron-right"} 
                  size={18} 
                  color={theme.textSecondary} 
                />
              </Pressable>
              {item.title === "Networks" && showNetworks ? (
                <View style={[styles.networksPanel, { backgroundColor: theme.backgroundDefault }]}>
                  {supportedNetworks.map((network, nIndex) => (
                    <View 
                      key={network.symbol} 
                      style={[
                        styles.networkRow,
                        nIndex > 0 ? { borderTopWidth: 1, borderTopColor: theme.border } : {},
                      ]}
                    >
                      <Image
                        source={{ uri: network.logoUrl }}
                        style={[styles.networkLogo, { backgroundColor: network.color + "20" }]}
                        contentFit="contain"
                      />
                      <View style={{ flex: 1, marginLeft: Spacing.md }}>
                        <ThemedText type="body" style={{ fontWeight: "500" }}>
                          {network.name}
                        </ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                          {network.symbol}
                        </ThemedText>
                      </View>
                      <View style={[styles.networkBadge, { backgroundColor: theme.success + "20" }]}>
                        <ThemedText type="caption" style={{ color: theme.success, fontSize: 10 }}>
                          Active
                        </ThemedText>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
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

      <PinInputModal
        visible={pinModalVisible}
        title={getPinModalTitle()}
        message={getPinModalMessage()}
        onSubmit={handlePinModalSubmit}
        onCancel={handlePinModalCancel}
        error={pinModalError}
        step={pinModalStep}
        loading={pinModalLoading}
      />
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
  networkRowItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
  },
  networksPanel: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomLeftRadius: BorderRadius.md,
    borderBottomRightRadius: BorderRadius.md,
  },
  networkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  networkLogo: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  networkBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.xs,
  },
});
