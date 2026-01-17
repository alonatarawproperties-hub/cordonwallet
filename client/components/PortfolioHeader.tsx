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

const ICON_SIZE = 22;
const ICON_HIT_SLOP = 12;

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
      <Pressable onPress={handlePress} style={styles.titleContainer} hitSlop={8}>
        <ThemedText style={styles.walletName} numberOfLines={1}>
          {walletName}
        </ThemedText>
        <Feather name="chevron-down" size={14} color={theme.textSecondary} style={styles.chevron} />
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
    <Pressable 
      onPress={handlePress} 
      hitSlop={ICON_HIT_SLOP} 
      style={styles.iconButton}
    >
      <Feather name="settings" size={ICON_SIZE} color={theme.text} />
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
    <View style={styles.rightContainer}>
      <Pressable 
        onPress={handleScan} 
        hitSlop={ICON_HIT_SLOP} 
        style={styles.iconButton}
      >
        <Feather name="maximize" size={ICON_SIZE} color={theme.text} />
      </Pressable>
      <Pressable 
        onPress={handleCopy} 
        hitSlop={ICON_HIT_SLOP} 
        style={[styles.iconButton, styles.iconButtonSpaced]}
      >
        <Feather 
          name={copied ? "check" : "copy"} 
          size={ICON_SIZE} 
          color={copied ? theme.success : theme.text} 
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  walletName: {
    fontSize: 17,
    fontWeight: "600",
    maxWidth: 180,
  },
  chevron: {
    marginLeft: 4,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonSpaced: {
    marginLeft: Spacing.xs,
  },
  rightContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
});
