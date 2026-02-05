import React, { useState, useEffect, useCallback, useRef } from "react";
import { View, StyleSheet, Pressable, Alert } from "react-native";
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
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "SeedPhraseExport">;

export default function SeedPhraseExportScreen({ navigation, route }: Props) {
  const { walletId, walletName } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const [seedPhrase, setSeedPhrase] = useState<string[] | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  const clipboardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    authenticateAndLoad();
  }, []);

  useEffect(() => {
    return () => {
      if (clipboardTimeoutRef.current) {
        clearTimeout(clipboardTimeoutRef.current);
      }
    };
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
          promptMessage: "Authenticate to view recovery phrase",
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
        setSeedPhrase(mnemonic.split(" "));
        setIsRevealed(true);
      } else {
        Alert.alert("Error", "Could not retrieve recovery phrase. Please unlock your wallet first.");
        navigation.goBack();
      }
    } catch (error) {
      console.error("Failed to load seed phrase:", error);
      Alert.alert("Error", "Failed to load recovery phrase.");
      navigation.goBack();
    }
  };

  const handleCopy = useCallback(async () => {
    if (!seedPhrase) return;
    
    await Clipboard.setStringAsync(seedPhrase.join(" "));
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);

    if (clipboardTimeoutRef.current) {
      clearTimeout(clipboardTimeoutRef.current);
    }
    clipboardTimeoutRef.current = setTimeout(() => {
      Clipboard.setStringAsync("");
    }, 30000);
    
    Alert.alert(
      "Copied",
      "Recovery phrase copied. Store it securely and clear your clipboard.",
      [{ text: "OK" }]
    );
    
    setTimeout(() => setCopied(false), 3000);
  }, [seedPhrase]);

  if (!isRevealed || !seedPhrase) {
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

      <View style={[styles.content, { paddingTop: Spacing.xl }]}>
        <ThemedText type="small" style={[styles.walletLabel, { color: theme.textSecondary }]}>
          {walletName}
        </ThemedText>

        <View style={styles.seedGrid}>
          {seedPhrase.map((word, index) => (
            <View 
              key={index} 
              style={[styles.wordCard, { backgroundColor: theme.backgroundSecondary }]}
            >
              <ThemedText type="small" style={[styles.wordNumber, { color: theme.textSecondary }]}>
                {index + 1}
              </ThemedText>
              <ThemedText type="body" style={styles.word}>
                {word}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.buttons, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <Pressable
          onPress={handleCopy}
          style={[styles.copyButton, { backgroundColor: copied ? theme.success : theme.accent }]}
          accessibilityRole="button"
          accessibilityLabel="Copy recovery phrase"
          accessibilityHint="Copies your recovery phrase to the clipboard"
        >
          <Feather name={copied ? "check" : "copy"} size={18} color="#fff" />
          <ThemedText type="body" style={styles.copyButtonText}>
            {copied ? "Copied" : "Copy to Clipboard"}
          </ThemedText>
        </Pressable>

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
    paddingHorizontal: Spacing.lg,
  },
  walletLabel: {
    textAlign: "center",
    marginBottom: Spacing.lg,
    letterSpacing: 0.5,
  },
  seedGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  wordCard: {
    width: "32%",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  wordNumber: {
    width: 18,
    fontSize: 11,
    fontWeight: "500",
  },
  word: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  buttons: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: BorderRadius.lg,
  },
  copyButtonText: {
    color: "#fff",
    fontWeight: "600",
    marginLeft: Spacing.sm,
  },
  doneButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
});
