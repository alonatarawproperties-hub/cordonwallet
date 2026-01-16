import React, { useState, useCallback } from "react";
import { View, StyleSheet, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "ExportWallet">;

export default function ExportWalletScreen({ navigation, route }: Props) {
  const { walletId, walletName } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
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
    <ThemedView style={styles.container}>
      <View style={[styles.content, { paddingTop: headerHeight + Spacing.xl }]}>
        <View style={styles.iconContainer}>
          <View style={[styles.iconOuter, { borderColor: theme.warning + "40" }]}>
            <View style={[styles.iconInner, { backgroundColor: theme.warning + "15" }]}>
              <Feather name="lock" size={28} color={theme.warning} />
            </View>
          </View>
        </View>

        <ThemedText type="small" style={[styles.walletLabel, { color: theme.textSecondary }]}>
          {walletName}
        </ThemedText>

        <ThemedText type="body" style={[styles.description, { color: theme.textSecondary }]}>
          Your recovery phrase and private keys provide full access to your funds. Keep them safe and never share.
        </ThemedText>

        <View style={[styles.warningCard, { backgroundColor: theme.danger + "08" }]}>
          <View style={styles.warningRow}>
            <Feather name="alert-circle" size={18} color={theme.danger} />
            <ThemedText type="body" style={[styles.warningTitle, { color: theme.danger }]}>
              Security Warning
            </ThemedText>
          </View>
          <ThemedText type="small" style={[styles.warningText, { color: theme.textSecondary }]}>
            Anyone with access to this information can permanently steal your funds. Cordon will never ask for it.
          </ThemedText>
        </View>

        <Pressable 
          onPress={handleToggleAcknowledge} 
          style={styles.checkboxRow}
        >
          <View style={[
            styles.checkbox, 
            { 
              backgroundColor: acknowledged ? theme.accent : "transparent",
              borderColor: acknowledged ? theme.accent : theme.border,
            }
          ]}>
            {acknowledged ? <Feather name="check" size={12} color="#fff" /> : null}
          </View>
          <ThemedText type="small" style={[styles.checkboxLabel, { color: theme.textSecondary }]}>
            I understand the risks and take full responsibility for securing this information.
          </ThemedText>
        </Pressable>
      </View>

      <View style={[styles.buttons, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <Pressable
          onPress={handleShowSeedPhrase}
          disabled={!acknowledged}
          style={[
            styles.primaryButton, 
            { 
              backgroundColor: acknowledged ? theme.accent : theme.accent + "40",
            }
          ]}
        >
          <Feather name="grid" size={18} color="#fff" />
          <ThemedText type="body" style={styles.primaryButtonText}>
            Show Recovery Phrase
          </ThemedText>
        </Pressable>

        <Pressable
          onPress={handleShowPrivateKey}
          disabled={!acknowledged}
          style={[
            styles.secondaryButton, 
            { 
              borderColor: theme.border,
              opacity: acknowledged ? 1 : 0.4,
            }
          ]}
        >
          <Feather name="key" size={18} color={theme.text} />
          <ThemedText type="body" style={{ marginLeft: Spacing.sm }}>
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
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
  },
  iconContainer: {
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  iconOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  iconInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
  },
  walletLabel: {
    textAlign: "center",
    marginBottom: Spacing.md,
    letterSpacing: 0.5,
  },
  description: {
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  warningCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.xl,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  warningTitle: {
    fontWeight: "600",
    marginLeft: Spacing.sm,
  },
  warningText: {
    lineHeight: 20,
    paddingLeft: 26,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.md,
    marginTop: 1,
  },
  checkboxLabel: {
    flex: 1,
    lineHeight: 20,
  },
  buttons: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: BorderRadius.lg,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "600",
    marginLeft: Spacing.sm,
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
});
