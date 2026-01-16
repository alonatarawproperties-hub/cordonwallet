import React, { useState, useCallback } from "react";
import { View, StyleSheet, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "ExportWallet">;

export default function ExportWalletScreen({ navigation, route }: Props) {
  const { walletId, walletName } = route.params;
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const [acknowledged, setAcknowledged] = useState(false);

  const handleToggleAcknowledge = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAcknowledged(!acknowledged);
  }, [acknowledged]);

  const handleShowSeedPhrase = useCallback(() => {
    if (!acknowledged) {
      Alert.alert("Please Acknowledge", "You must acknowledge the warning before proceeding.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate("SeedPhraseExport", { walletId, walletName });
  }, [acknowledged, navigation, walletId, walletName]);

  const handleShowPrivateKey = useCallback(() => {
    if (!acknowledged) {
      Alert.alert("Please Acknowledge", "You must acknowledge the warning before proceeding.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate("PrivateKeyExport", { walletId, walletName });
  }, [acknowledged, navigation, walletId, walletName]);

  return (
    <ThemedView style={[styles.container, { paddingBottom: insets.bottom + Spacing.xl }]}>
      <View style={styles.content}>
        <View style={[styles.warningIcon, { backgroundColor: theme.danger + "20" }]}>
          <Feather name="alert-triangle" size={48} color={theme.danger} />
        </View>

        <ThemedText type="h2" style={styles.title}>
          Backup Your Wallet
        </ThemedText>

        <ThemedText type="body" style={[styles.description, { color: theme.textSecondary }]}>
          Your recovery phrase and private keys give full access to your wallet and funds.
        </ThemedText>

        <View style={[styles.warningCard, { backgroundColor: theme.danger + "10", borderColor: theme.danger + "30" }]}>
          <Feather name="shield-off" size={20} color={theme.danger} />
          <View style={styles.warningTextContainer}>
            <ThemedText type="body" style={{ fontWeight: "600", color: theme.danger }}>
              Never share with anyone
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.danger, marginTop: 2 }}>
              Anyone with this information can steal your funds permanently. Cordon support will never ask for it.
            </ThemedText>
          </View>
        </View>

        <Pressable 
          onPress={handleToggleAcknowledge} 
          style={[styles.checkboxRow, { borderColor: acknowledged ? theme.accent : theme.border }]}
        >
          <View style={[
            styles.checkbox, 
            { 
              backgroundColor: acknowledged ? theme.accent : "transparent",
              borderColor: acknowledged ? theme.accent : theme.border,
            }
          ]}>
            {acknowledged ? <Feather name="check" size={14} color="#fff" /> : null}
          </View>
          <ThemedText type="body" style={styles.checkboxLabel}>
            I understand that if I lose my recovery phrase, I will lose access to my funds forever.
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.buttons}>
        <Button
          onPress={handleShowSeedPhrase}
          disabled={!acknowledged}
          style={[styles.button, !acknowledged && { opacity: 0.5 }]}
        >
          Show Recovery Phrase
        </Button>

        <Pressable
          onPress={handleShowPrivateKey}
          disabled={!acknowledged}
          style={[
            styles.secondaryButton, 
            { 
              borderColor: theme.border,
              opacity: acknowledged ? 1 : 0.5,
            }
          ]}
        >
          <Feather name="key" size={18} color={theme.text} />
          <ThemedText type="body" style={{ marginLeft: Spacing.sm, fontWeight: "500" }}>
            Export Private Keys
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
  },
  content: {
    flex: 1,
    alignItems: "center",
    paddingTop: Spacing["3xl"],
  },
  warningIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  description: {
    textAlign: "center",
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  warningCard: {
    flexDirection: "row",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.xl,
    alignItems: "flex-start",
  },
  warningTextContainer: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
    marginTop: 2,
  },
  checkboxLabel: {
    flex: 1,
    lineHeight: 22,
  },
  buttons: {
    gap: Spacing.md,
  },
  button: {
    width: "100%",
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
});
