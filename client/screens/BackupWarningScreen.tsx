import { useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "BackupWarning">;

export default function BackupWarningScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { seedPhrase, walletId } = route.params;
  const [acknowledged, setAcknowledged] = useState(false);

  const warnings = [
    { icon: "eye-off" as const, text: "Your seed phrase is the only way to recover your wallet" },
    { icon: "lock" as const, text: "Never share it with anyone, not even Cordon support" },
    { icon: "file-text" as const, text: "Write it down on paper and store it securely" },
    { icon: "alert-circle" as const, text: "If you lose it, your funds cannot be recovered" },
  ];

  return (
    <ThemedView style={[styles.container, { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing["2xl"] }]}>
      <View style={styles.content}>
        <View style={[styles.iconContainer, { backgroundColor: theme.warning + "20" }]}>
          <Feather name="alert-triangle" size={40} color={theme.warning} />
        </View>

        <ThemedText type="h2" style={styles.title}>
          Back Up Your Wallet
        </ThemedText>
        <ThemedText type="body" style={[styles.subtitle, { color: theme.textSecondary }]}>
          Your seed phrase is the master key to your wallet. Read these warnings carefully.
        </ThemedText>

        <View style={styles.warnings}>
          {warnings.map((warning, index) => (
            <View key={index} style={[styles.warningRow, { backgroundColor: theme.backgroundDefault }]}>
              <View style={[styles.warningIcon, { backgroundColor: theme.warning + "20" }]}>
                <Feather name={warning.icon} size={20} color={theme.warning} />
              </View>
              <ThemedText type="body" style={styles.warningText}>
                {warning.text}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <Pressable 
          style={styles.checkbox}
          onPress={() => setAcknowledged(!acknowledged)}
        >
          <View style={[
            styles.checkboxBox, 
            { borderColor: acknowledged ? theme.accent : theme.border, backgroundColor: acknowledged ? theme.accent : "transparent" }
          ]}>
            {acknowledged ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
          </View>
          <ThemedText type="small" style={{ flex: 1 }}>
            I understand that I am responsible for backing up my seed phrase
          </ThemedText>
        </Pressable>

        <Button 
          onPress={() => navigation.navigate("SeedPhrase", { seedPhrase, walletId })}
          disabled={!acknowledged}
        >
          Show Seed Phrase
        </Button>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing["2xl"],
  },
  content: {
    flex: 1,
    alignItems: "center",
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.xl,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing["2xl"],
  },
  title: {
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
    marginBottom: Spacing["2xl"],
  },
  warnings: {
    width: "100%",
    gap: Spacing.md,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  warningIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  warningText: {
    flex: 1,
  },
  footer: {
    gap: Spacing.lg,
  },
  checkbox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  checkboxBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
