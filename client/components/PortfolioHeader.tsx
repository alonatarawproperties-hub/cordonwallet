import React, { useState, useCallback } from "react";
import { View, StyleSheet, Pressable, Image } from "react-native";
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

function shortenAddress(address: string): string {
  if (!address || address.length < 12) return address || "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function PortfolioHeaderTitle() {
  const { theme } = useTheme();
  const { activeWallet, selectedNetwork } = useWallet();
  const [switcherVisible, setSwitcherVisible] = useState(false);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSwitcherVisible(true);
  }, []);

  const walletName = activeWallet?.name || "No Wallet";
  const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address;
  const solanaAddress = activeWallet?.addresses?.solana;
  
  const displayAddress = selectedNetwork === "solana" && solanaAddress 
    ? solanaAddress 
    : evmAddress;

  return (
    <>
      <Pressable onPress={handlePress} style={styles.container}>
        <Image
          source={require("../../assets/images/icon.png")}
          style={styles.icon}
          resizeMode="contain"
        />
        <View style={styles.textContainer}>
          <View style={styles.nameRow}>
            <ThemedText style={styles.walletName} numberOfLines={1}>
              {walletName}
            </ThemedText>
            <Feather name="chevron-down" size={16} color={theme.textSecondary} style={{ marginLeft: 2 }} />
          </View>
          {displayAddress ? (
            <ThemedText style={[styles.address, { color: theme.textSecondary }]} numberOfLines={1}>
              {shortenAddress(displayAddress)}
            </ThemedText>
          ) : null}
        </View>
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
    navigation.navigate("WalletManager");
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
    paddingHorizontal: Spacing.sm,
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: 6,
  },
  textContainer: {
    marginLeft: Spacing.xs,
    alignItems: "flex-start",
    maxWidth: 140,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  walletName: {
    fontSize: 16,
    fontWeight: "600",
    maxWidth: 110,
  },
  address: {
    fontSize: 11,
    marginTop: -2,
  },
  headerButton: {
    padding: Spacing.xs,
  },
  headerRightContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
});
