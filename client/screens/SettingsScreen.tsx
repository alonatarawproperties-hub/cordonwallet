import { useState, useRef, useEffect, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable, Alert, Switch, Platform } from "react-native";
import { Image } from "expo-image";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { PinInputModal } from "@/components/PinInputModal";
import { useWallet } from "@/lib/wallet-context";
import { useDemo } from "@/lib/demo/context";
import { useDevSettings } from "@/context/DevSettingsContext";
import { getDefaultChain } from "@/lib/blockchain/chains";
import { hasBiometricPinEnabled, isBiometricAvailable, savePinForBiometrics, disableBiometrics, verifyPin, verifyPinFast, changePin, getPinWithBiometrics } from "@/lib/wallet-engine";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

type SettingsRowProps = {
  title: string;
  subtitle?: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  onPress?: () => void;
  disabled?: boolean;
  rightElement?: React.ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
};

function SettingsRow({ title, subtitle, icon, iconColor, onPress, disabled, rightElement, isFirst, isLast }: SettingsRowProps) {
  const { theme } = useTheme();

  return (
    <>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          { opacity: pressed ? 0.7 : disabled ? 0.5 : 1 },
        ]}
        onPress={onPress}
        disabled={disabled}
      >
        <View style={[styles.rowIcon, { backgroundColor: iconColor + "15" }]}>
          <Ionicons name={icon} size={20} color={iconColor} />
        </View>
        <View style={styles.rowContent}>
          <ThemedText type="body" style={styles.rowTitle}>{title}</ThemedText>
          {subtitle ? (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>{subtitle}</ThemedText>
          ) : null}
        </View>
        {rightElement || (
          <Feather name="chevron-right" size={16} color={theme.textSecondary} style={{ opacity: 0.5 }} />
        )}
      </Pressable>
      {!isLast ? <View style={[styles.separator, { backgroundColor: theme.separator }]} /> : null}
    </>
  );
}

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
    { name: "Solana", symbol: "SOL", color: "#9945FF", logoUrl: "https://assets.coingecko.com/coins/images/4128/small/solana.png" },
  ];

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

    const hasBiometric = await hasBiometricPinEnabled();
    if (hasBiometric) {
      try {
        const storedPin = await getPinWithBiometrics();
        if (storedPin) {
          setCurrentPinValue(storedPin);
          setPinModalStep("new");
          setPinModalVisible(true);
          return;
        }
      } catch {
        // Biometric failed, fall back to PIN entry
      }
    }

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
    if (!__DEV__) return;
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

  const chainConfig = getDefaultChain();

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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.xl,
        paddingBottom: insets.bottom + Spacing["3xl"],
        paddingHorizontal: Spacing.xl,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
      showsVerticalScrollIndicator={false}
    >
      {/* Security */}
      <View style={styles.section}>
        <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
          SECURITY
        </ThemedText>
        <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <SettingsRow
            icon="shield-checkmark"
            iconColor={theme.accent}
            title="Wallet Firewall"
            subtitle="Protect your transactions"
            onPress={() => navigation.navigate("PolicySettings")}
            isFirst
          />
          <SettingsRow
            icon="finger-print"
            iconColor={theme.accent}
            title="Biometric Unlock"
            subtitle={getBiometricSubtitle()}
            onPress={handleBiometricToggle}
            disabled={isTogglingBiometric}
            rightElement={
              biometricAvailable ? (
                <Switch
                  value={biometricEnabled}
                  onValueChange={handleBiometricToggle}
                  trackColor={{ false: theme.border, true: theme.accent }}
                  thumbColor="#fff"
                  disabled={isTogglingBiometric}
                />
              ) : undefined
            }
          />
          <SettingsRow
            icon="key"
            iconColor={theme.accent}
            title="Change PIN"
            subtitle="Update your security PIN"
            onPress={handleChangePin}
            isLast
          />
        </View>
      </View>

      {/* Wallet */}
      <View style={styles.section}>
        <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
          WALLET
        </ThemedText>
        <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <SettingsRow
            icon="wallet"
            iconColor={theme.success}
            title="Manage Wallets"
            subtitle={activeWallet?.name || "No wallet"}
            onPress={() => navigation.navigate("WalletManager")}
            isFirst
          />
          <SettingsRow
            icon="checkmark-circle"
            iconColor={theme.success}
            title="Token Approvals"
            subtitle="Manage contract approvals"
            onPress={() => navigation.navigate("Approvals")}
          />
          <SettingsRow
            icon="scan"
            iconColor={theme.success}
            title="WalletConnect"
            subtitle="Connect to dApps"
            onPress={() => navigation.navigate("WalletConnect")}
          />
          <SettingsRow
            icon="globe"
            iconColor={theme.success}
            title="Networks"
            subtitle={allNetworks.map(n => n.name).join(", ")}
            onPress={() => setShowNetworks(!showNetworks)}
            isLast={!showNetworks}
            rightElement={
              <Feather
                name={showNetworks ? "chevron-up" : "chevron-down"}
                size={16}
                color={theme.textSecondary}
                style={{ opacity: 0.5 }}
              />
            }
          />
          {showNetworks ? (
            <View style={[styles.networksInline, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]}>
              {allNetworks.map((network) => (
                <View key={network.symbol} style={styles.networkRow}>
                  <Image
                    source={{ uri: network.logoUrl }}
                    style={[styles.networkLogo, { backgroundColor: network.color + "15" }]}
                    contentFit="contain"
                  />
                  <View style={{ flex: 1 }}>
                    <ThemedText type="body" style={{ fontWeight: "500" }}>
                      {network.name}
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      {network.symbol}
                    </ThemedText>
                  </View>
                  <View style={[styles.activeBadge, { backgroundColor: theme.success + "15" }]}>
                    <View style={[styles.activeDot, { backgroundColor: theme.success }]} />
                    <ThemedText type="caption" style={{ color: theme.success, fontSize: 11 }}>
                      Active
                    </ThemedText>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      {/* About */}
      <View style={styles.section}>
        <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
          ABOUT
        </ThemedText>
        <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <SettingsRow
            icon="chatbubble-ellipses"
            iconColor={theme.textSecondary}
            title="Help & Support"
            subtitle="Get help with Cordon"
            onPress={() => {}}
            isFirst
          />
          <SettingsRow
            icon="document-text"
            iconColor={theme.textSecondary}
            title="Terms of Service"
            subtitle="Legal information"
            onPress={() => {}}
          />
          <SettingsRow
            icon="information-circle"
            iconColor={theme.textSecondary}
            title="Version"
            subtitle="1.0.0"
            onPress={handleVersionTap}
            isLast
            rightElement={<ThemedText type="caption" style={{ color: theme.textSecondary }}>1.0.0</ThemedText>}
          />
        </View>
      </View>

      {/* Dev: Demo Mode */}
      {__DEV__ && showDebug ? (
        <View style={styles.section}>
          <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.accent }]}>
            DEMO MODE
          </ThemedText>
          <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: theme.accent + "15" }]}>
                <Ionicons name="play-circle" size={20} color={theme.accent} />
              </View>
              <View style={styles.rowContent}>
                <ThemedText type="body" style={styles.rowTitle}>Demo Mode</ThemedText>
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
              <>
                <View style={[styles.separator, { backgroundColor: theme.separator }]} />
                <Pressable
                  onPress={() => navigation.navigate("DemoFlow")}
                  style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <View style={[styles.rowIcon, { backgroundColor: theme.accent + "15" }]}>
                    <Ionicons name="images" size={20} color={theme.accent} />
                  </View>
                  <View style={styles.rowContent}>
                    <ThemedText type="body" style={styles.rowTitle}>Export Demo Assets</ThemedText>
                  </View>
                  <Feather name="chevron-right" size={16} color={theme.textSecondary} style={{ opacity: 0.5 }} />
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Dev: Debug */}
      {__DEV__ && showDebug ? (
        <View style={styles.section}>
          <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.warning }]}>
            DEVELOPER
          </ThemedText>
          <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: theme.warning + "15" }]}>
                <Ionicons name="code-slash" size={20} color={theme.warning} />
              </View>
              <View style={styles.rowContent}>
                <ThemedText type="body" style={styles.rowTitle}>Simulate Cordon Browser</ThemedText>
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
            <View style={[styles.separator, { backgroundColor: theme.separator }]} />
            <Pressable
              style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => navigation.navigate("SwapDebug")}
            >
              <View style={[styles.rowIcon, { backgroundColor: theme.warning + "15" }]}>
                <Ionicons name="terminal" size={20} color={theme.warning} />
              </View>
              <View style={styles.rowContent}>
                <ThemedText type="body" style={styles.rowTitle}>Swap Debug Logs</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  View recent swap build/send logs
                </ThemedText>
              </View>
              <Feather name="chevron-right" size={16} color={theme.textSecondary} style={{ opacity: 0.5 }} />
            </Pressable>
            <View style={[styles.separator, { backgroundColor: theme.separator }]} />
            <View style={styles.debugInfo}>
              <View style={styles.debugInfoRow}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>Chain ID</ThemedText>
                <ThemedText type="caption" style={{ fontFamily: "monospace" }}>{chainId}</ThemedText>
              </View>
              <View style={styles.debugInfoRow}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>Network</ThemedText>
                <ThemedText type="caption">{chainConfig?.name || "Unknown"}</ThemedText>
              </View>
              <View style={styles.debugInfoRow}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>RPC Host</ThemedText>
                <ThemedText type="caption" style={{ fontFamily: "monospace", fontSize: 10 }} numberOfLines={1}>
                  {chainConfig ? new URL(chainConfig.rpcUrl).host : "N/A"}
                </ThemedText>
              </View>
              <View style={styles.debugInfoRow}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>Testnet</ThemedText>
                <ThemedText type="caption">{chainConfig?.isTestnet ? "Yes" : "No"}</ThemedText>
              </View>
              <View style={styles.debugInfoRow}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>Explorer</ThemedText>
                <ThemedText type="caption" style={{ fontFamily: "monospace", fontSize: 10 }} numberOfLines={1}>
                  {chainConfig?.explorerBaseUrl || "N/A"}
                </ThemedText>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      {/* Remove Wallet */}
      <Pressable
        style={({ pressed }) => [
          styles.removeButton,
          { borderColor: theme.danger + "30", opacity: pressed ? 0.7 : 1 },
        ]}
        onPress={handleLogout}
      >
        <Ionicons name="trash-outline" size={20} color={theme.danger} />
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
        loadingMessage={pinModalStep === "current" ? "Verifying PIN..." : "Updating PIN..."}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  card: {
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    borderWidth: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontWeight: "500",
    fontSize: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
  },
  networksInline: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  networkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  networkLogo: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    gap: 5,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  debugInfo: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  debugInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  removeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
});
