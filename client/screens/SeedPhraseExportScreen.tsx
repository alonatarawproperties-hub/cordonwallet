import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import * as LocalAuthentication from "expo-local-authentication";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { getMnemonic } from "@/lib/wallet-engine";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "SeedPhraseExport">;

export default function SeedPhraseExportScreen({ navigation, route }: Props) {
  const { walletId, walletName } = route.params;
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const [seedPhrase, setSeedPhrase] = useState<string[] | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
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
    
    Alert.alert(
      "Copied to Clipboard",
      "Your recovery phrase has been copied. Make sure to store it securely and clear your clipboard.",
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
    <ThemedView style={[styles.container, { paddingBottom: insets.bottom + Spacing.xl }]}>
      <View style={[styles.warningBanner, { backgroundColor: theme.warning + "15" }]}>
        <Feather name="eye-off" size={16} color={theme.warning} />
        <ThemedText type="small" style={{ color: theme.warning, marginLeft: Spacing.sm, flex: 1 }}>
          Make sure no one is watching. Auto-hiding in {timeLeft}s
        </ThemedText>
      </View>

      <View style={styles.content}>
        <ThemedText type="h3" style={styles.title}>
          Recovery Phrase
        </ThemedText>
        <ThemedText type="small" style={[styles.subtitle, { color: theme.textSecondary }]}>
          {walletName}
        </ThemedText>

        <View style={styles.seedGrid}>
          {seedPhrase.map((word, index) => (
            <View 
              key={index} 
              style={[styles.wordCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}
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

      <View style={styles.buttons}>
        <Button onPress={handleCopy} style={styles.button}>
          <View style={styles.buttonContent}>
            <Feather name={copied ? "check" : "copy"} size={18} color="#fff" />
            <ThemedText type="body" style={{ color: "#fff", marginLeft: Spacing.sm, fontWeight: "600" }}>
              {copied ? "Copied!" : "Copy to Clipboard"}
            </ThemedText>
          </View>
        </Button>

        <Pressable
          onPress={() => navigation.goBack()}
          style={[styles.secondaryButton, { borderColor: theme.border }]}
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
  seedGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  wordCard: {
    width: "31%",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  wordNumber: {
    width: 20,
    fontSize: 11,
  },
  word: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  buttons: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  button: {
    width: "100%",
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
});
