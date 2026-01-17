import React, { useState, useCallback } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";

import { ThemedText } from "@/components/ThemedText";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { useWallet } from "@/lib/wallet-context";
import { WalletSwitcherSheet } from "@/components/WalletSwitcherSheet";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export function PortfolioHeaderTitle() {
  const { theme } = useTheme();
  const { activeWallet } = useWallet();
  const [switcherVisible, setSwitcherVisible] = useState(false);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSwitcherVisible(true);
  }, []);

  const walletName = activeWallet?.name || "No Wallet";

  return (
    <>
      <Pressable onPress={handlePress} style={styles.container}>
        <ThemedText style={styles.walletName} numberOfLines={1}>
          {walletName}
        </ThemedText>
        <Feather name="chevron-down" size={16} color={theme.text} style={{ marginLeft: 4 }} />
      </Pressable>
      <WalletSwitcherSheet 
        visible={switcherVisible} 
        onClose={() => setSwitcherVisible(false)} 
      />
    </>
  );
}

export function PortfolioHeaderLeft() {
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("Settings");
  }, [navigation]);

  return (
    <Pressable onPress={handlePress} hitSlop={12} style={styles.headerButton}>
      <Feather name="settings" size={22} color={theme.text} />
    </Pressable>
  );
}

export function PortfolioHeaderRight() {
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { activeWallet, selectedNetwork } = useWallet();
  const [copied, setCopied] = useState(false);

  const handleScan = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("WalletConnect");
  }, [navigation]);

  const handleCopy = useCallback(async () => {
    const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address;
    const solanaAddress = activeWallet?.addresses?.solana;
    
    const addressToCopy = selectedNetwork === "solana" && solanaAddress 
      ? solanaAddress 
      : evmAddress;

    if (addressToCopy) {
      await Clipboard.setStringAsync(addressToCopy);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [activeWallet, selectedNetwork]);

  return (
    <View style={styles.headerRightContainer}>
      <Pressable onPress={handleScan} hitSlop={12} style={styles.headerButton}>
        <Feather name="maximize" size={20} color={theme.text} />
      </Pressable>
      <Pressable onPress={handleCopy} hitSlop={12} style={[styles.headerButton, { marginLeft: Spacing.md }]}>
        <Feather name={copied ? "check" : "copy"} size={20} color={copied ? theme.success : theme.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  walletName: {
    fontSize: 17,
    fontWeight: "600",
    maxWidth: 200,
  },
  headerButton: {
    padding: Spacing.xs,
  },
  headerRightContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
});
