import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet, Pressable, Alert, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
    <ThemedView style={[styles.container, { paddingBottom: insets.bottom + Spacing.xl }]}>
      <View style={[styles.warningBanner, { backgroundColor: theme.warning + "15" }]}>
        <Feather name="eye-off" size={16} color={theme.warning} />
        <ThemedText type="small" style={{ color: theme.warning, marginLeft: Spacing.sm, flex: 1 }}>
          Make sure no one is watching. Auto-hiding in {timeLeft}s
        </ThemedText>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <ThemedText type="h3" style={styles.title}>
          Private Keys
        </ThemedText>
        <ThemedText type="small" style={[styles.subtitle, { color: theme.textSecondary }]}>
          {walletName}
        </ThemedText>

        {evmPrivateKey ? (
          <View style={[styles.keyCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
            <View style={styles.keyHeader}>
              <View style={[styles.chainBadge, { backgroundColor: "#627EEA20" }]}>
                <ThemedText type="small" style={{ color: "#627EEA", fontWeight: "600" }}>
                  EVM
                </ThemedText>
              </View>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Ethereum, Polygon, BSC
              </ThemedText>
            </View>
            <View style={[styles.keyBox, { backgroundColor: theme.backgroundRoot }]}>
              <ThemedText type="small" style={[styles.keyText, { color: theme.text }]} selectable>
                {evmPrivateKey}
              </ThemedText>
            </View>
            <Pressable 
              onPress={handleCopyEvm} 
              style={[styles.copyButton, { backgroundColor: copiedEvm ? theme.success + "20" : theme.accent + "15" }]}
            >
              <Feather name={copiedEvm ? "check" : "copy"} size={16} color={copiedEvm ? theme.success : theme.accent} />
              <ThemedText type="small" style={{ marginLeft: Spacing.xs, color: copiedEvm ? theme.success : theme.accent, fontWeight: "500" }}>
                {copiedEvm ? "Copied!" : "Copy"}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {solanaPrivateKey ? (
          <View style={[styles.keyCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
            <View style={styles.keyHeader}>
              <View style={[styles.chainBadge, { backgroundColor: "#9945FF20" }]}>
                <ThemedText type="small" style={{ color: "#9945FF", fontWeight: "600" }}>
                  Solana
                </ThemedText>
              </View>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Solana Mainnet
              </ThemedText>
            </View>
            <View style={[styles.keyBox, { backgroundColor: theme.backgroundRoot }]}>
              <ThemedText type="small" style={[styles.keyText, { color: theme.text }]} selectable>
                {solanaPrivateKey}
              </ThemedText>
            </View>
            <Pressable 
              onPress={handleCopySolana} 
              style={[styles.copyButton, { backgroundColor: copiedSolana ? theme.success + "20" : theme.accent + "15" }]}
            >
              <Feather name={copiedSolana ? "check" : "copy"} size={16} color={copiedSolana ? theme.success : theme.accent} />
              <ThemedText type="small" style={{ marginLeft: Spacing.xs, color: copiedSolana ? theme.success : theme.accent, fontWeight: "500" }}>
                {copiedSolana ? "Copied!" : "Copy"}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        <View style={[styles.infoCard, { backgroundColor: theme.accent + "10", borderColor: theme.accent + "30" }]}>
          <Feather name="info" size={16} color={theme.accent} />
          <ThemedText type="small" style={{ flex: 1, marginLeft: Spacing.sm, color: theme.textSecondary }}>
            Private keys are used to import your wallet into other apps. Each blockchain has its own key format.
          </ThemedText>
        </View>
      </ScrollView>

      <View style={styles.buttons}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={[styles.doneButton, { borderColor: theme.border }]}
        >
          <ThemedText type="body" style={{ fontWeight: "500" }}>
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
  warningBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.xs,
  },
  subtitle: {
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  keyCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  keyHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  chainBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: Spacing.sm,
  },
  keyBox: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
  },
  keyText: {
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  infoCard: {
    flexDirection: "row",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginBottom: Spacing.xl,
  },
  buttons: {
    paddingHorizontal: Spacing.xl,
  },
  doneButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
});
