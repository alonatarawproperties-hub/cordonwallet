import React, { useState, useCallback } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";

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
        <View style={[styles.statusDot, { backgroundColor: theme.success }]} />
        <ThemedText style={styles.walletName} numberOfLines={1}>
          {walletName}
        </ThemedText>
        <Feather name="chevron-down" size={12} color={theme.textSecondary} style={styles.chevron} />
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
      style={styles.leftIconButton}
    >
      <Feather name="settings" size={ICON_SIZE} color={theme.text} />
    </Pressable>
  );
}

export function PortfolioHeaderRight() {
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { activeWallet } = useWallet();

  const handleScan = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("WalletConnect");
  }, [navigation]);

  const handleReceive = useCallback(() => {
    const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address || "";
    const solanaAddress = activeWallet?.addresses?.solana;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("Receive", {
      walletAddress: evmAddress,
      solanaAddress: solanaAddress
    });
  }, [activeWallet, navigation]);

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
        onPress={handleReceive}
        hitSlop={ICON_HIT_SLOP}
        style={styles.iconButton}
      >
        <Feather
          name="copy"
          size={ICON_SIZE}
          color={theme.text}
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
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 6,
  },
  walletName: {
    fontSize: 16,
    fontWeight: "600",
    maxWidth: 180,
  },
  chevron: {
    marginLeft: 4,
  },
  leftIconButton: {
    marginLeft: Spacing.sm,
    padding: Spacing.sm,
  },
  iconButton: {
    padding: Spacing.sm,
    marginLeft: Spacing.md,
  },
  rightContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: Spacing.sm,
  },
});
