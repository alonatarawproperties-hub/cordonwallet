import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet, Pressable, Alert, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import * as LocalAuthentication from "expo-local-authentication";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { getMnemonic } from "@/lib/wallet-engine";
import { deriveEvmPrivateKey, deriveSolanaPrivateKey } from "@/lib/blockchain/keys";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "PrivateKeyExport">;

export default function PrivateKeyExportScreen({ navigation, route }: Props) {
  const { walletId, walletName } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const [evmPrivateKey, setEvmPrivateKey] = useState<string | null>(null);
  const [solanaPrivateKey, setSolanaPrivateKey] = useState<string | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [copiedEvm, setCopiedEvm] = useState(false);
  const [copiedSolana, setCopiedSolana] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);

  useEffect(() => {
    authenticateAndLoad();
  }, []);

  useEffect(() => {
    if (isRevealed && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else if (timeLeft === 0) {
      navigation.goBack();
    }
  }, [isRevealed, timeLeft, navigation]);

  const authenticateAndLoad = async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (hasHardware && isEnrolled) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: "Authenticate to view private keys",
          fallbackLabel: "Use PIN",
        });

        if (!result.success) {
          Alert.alert("Authentication Failed", "Please try again.");
          navigation.goBack();
          return;
        }
      }

      const mnemonic = await getMnemonic(walletId);
      if (mnemonic) {
        const evmKey = deriveEvmPrivateKey(mnemonic);
        const solanaKey = deriveSolanaPrivateKey(mnemonic);
        setEvmPrivateKey(evmKey);
        setSolanaPrivateKey(solanaKey);
        setIsRevealed(true);
      } else {
        Alert.alert("Error", "Could not retrieve private keys. Please unlock your wallet first.");
        navigation.goBack();
      }
    } catch (error) {
      console.error("Failed to load private keys:", error);
      Alert.alert("Error", "Failed to load private keys.");
      navigation.goBack();
    }
  };

  const handleCopyEvm = useCallback(async () => {
    if (!evmPrivateKey) return;
    
    await Clipboard.setStringAsync(evmPrivateKey);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedEvm(true);
    setTimeout(() => setCopiedEvm(false), 3000);
  }, [evmPrivateKey]);

  const handleCopySolana = useCallback(async () => {
    if (!solanaPrivateKey) return;
    
    await Clipboard.setStringAsync(solanaPrivateKey);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedSolana(true);
    setTimeout(() => setCopiedSolana(false), 3000);
  }, [solanaPrivateKey]);

  if (!isRevealed) {
    return (
      <ThemedView style={[styles.container, styles.loadingContainer]}>
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          Authenticating...
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.timerBar, { backgroundColor: theme.warning + "10" }]}>
        <Feather name="clock" size={14} color={theme.warning} />
        <ThemedText type="small" style={[styles.timerText, { color: theme.warning }]}>
          Auto-hiding in {timeLeft}s
        </ThemedText>
        <View style={[styles.timerProgress, { backgroundColor: theme.warning + "30" }]}>
          <View style={[styles.timerFill, { backgroundColor: theme.warning, width: `${(timeLeft / 60) * 100}%` }]} />
        </View>
      </View>

      <ScrollView 
        style={styles.content} 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText type="small" style={[styles.walletLabel, { color: theme.textSecondary }]}>
          {walletName}
        </ThemedText>

        {evmPrivateKey ? (
          <View style={[styles.keyCard, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={styles.keyHeader}>
              <View style={[styles.chainDot, { backgroundColor: "#627EEA" }]} />
              <ThemedText type="body" style={styles.chainName}>
                EVM Networks
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                ETH, Polygon, BSC
              </ThemedText>
            </View>
            <View style={[styles.keyBox, { backgroundColor: theme.backgroundRoot }]}>
              <ThemedText type="small" style={[styles.keyText, { color: theme.text }]} selectable>
                {evmPrivateKey}
              </ThemedText>
            </View>
            <Pressable onPress={handleCopyEvm} style={styles.copyRow}>
              <Feather 
                name={copiedEvm ? "check" : "copy"} 
                size={14} 
                color={copiedEvm ? theme.success : theme.accent} 
              />
              <ThemedText 
                type="small" 
                style={[styles.copyText, { color: copiedEvm ? theme.success : theme.accent }]}
              >
                {copiedEvm ? "Copied" : "Copy"}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {solanaPrivateKey ? (
          <View style={[styles.keyCard, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={styles.keyHeader}>
              <View style={[styles.chainDot, { backgroundColor: "#9945FF" }]} />
              <ThemedText type="body" style={styles.chainName}>
                Solana
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Mainnet
              </ThemedText>
            </View>
            <View style={[styles.keyBox, { backgroundColor: theme.backgroundRoot }]}>
              <ThemedText type="small" style={[styles.keyText, { color: theme.text }]} selectable>
                {solanaPrivateKey}
              </ThemedText>
            </View>
            <Pressable onPress={handleCopySolana} style={styles.copyRow}>
              <Feather 
                name={copiedSolana ? "check" : "copy"} 
                size={14} 
                color={copiedSolana ? theme.success : theme.accent} 
              />
              <ThemedText 
                type="small" 
                style={[styles.copyText, { color: copiedSolana ? theme.success : theme.accent }]}
              >
                {copiedSolana ? "Copied" : "Copy"}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.infoRow}>
          <Feather name="info" size={14} color={theme.textSecondary} />
          <ThemedText type="small" style={[styles.infoText, { color: theme.textSecondary }]}>
            Use these keys to import your wallet into other apps. Each blockchain requires its specific key format.
          </ThemedText>
        </View>
      </ScrollView>

      <View style={[styles.buttons, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.doneButton}
        >
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Done
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    justifyContent: "center",
    alignItems: "center",
  },
  timerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  timerText: {
    marginLeft: Spacing.sm,
    fontWeight: "500",
  },
  timerProgress: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    marginLeft: Spacing.md,
    overflow: "hidden",
  },
  timerFill: {
    height: "100%",
    borderRadius: 2,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  walletLabel: {
    textAlign: "center",
    marginBottom: Spacing.lg,
    letterSpacing: 0.5,
  },
  keyCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
  },
  keyHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  chainDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.sm,
  },
  chainName: {
    fontWeight: "600",
    marginRight: Spacing.sm,
  },
  keyBox: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  keyText: {
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 18,
  },
  copyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
  },
  copyText: {
    marginLeft: Spacing.xs,
    fontWeight: "500",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: Spacing.md,
  },
  infoText: {
    flex: 1,
    marginLeft: Spacing.sm,
    lineHeight: 18,
  },
  buttons: {
    paddingHorizontal: Spacing.lg,
  },
  doneButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
});
