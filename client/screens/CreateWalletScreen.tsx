import { useState } from "react";
import { View, StyleSheet, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { generateMnemonic } from "@/lib/wallet-engine";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "CreateWallet">;

export default function CreateWalletScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const [walletName, setWalletName] = useState("Main Wallet");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!walletName.trim()) {
      Alert.alert("Error", "Please enter a wallet name");
      return;
    }

    setIsCreating(true);
    
    try {
      const mnemonic = generateMnemonic();
      navigation.navigate("SetupPin", { 
        mnemonic, 
        walletName: walletName.trim(),
        isImport: false 
      });
    } catch (error) {
      Alert.alert("Error", "Failed to generate wallet. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing["2xl"] },
        ]}
      >
        <View style={[styles.infoCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[styles.iconContainer, { backgroundColor: theme.accent + "20" }]}>
            <Feather name="shield" size={32} color={theme.accent} />
          </View>
          <ThemedText type="h3" style={styles.infoTitle}>
            Create a New Wallet
          </ThemedText>
          <ThemedText type="body" style={[styles.infoText, { color: theme.textSecondary }]}>
            Your wallet will be generated securely on this device. The seed phrase will be shown once - make sure to back it up safely.
          </ThemedText>
        </View>

        <View style={styles.form}>
          <Input
            label="Wallet Name"
            value={walletName}
            onChangeText={setWalletName}
            placeholder="Enter wallet name"
            autoCapitalize="words"
          />
        </View>

        <View style={[styles.warningCard, { backgroundColor: theme.warning + "15", borderColor: theme.warning + "40" }]}>
          <Feather name="alert-triangle" size={20} color={theme.warning} />
          <ThemedText type="small" style={{ color: theme.warning, flex: 1 }}>
            Never share your seed phrase with anyone. Cordon will never ask for it.
          </ThemedText>
        </View>

        <View style={styles.footer}>
          <Button onPress={handleCreate} disabled={isCreating}>
            {isCreating ? "Creating..." : "Create Wallet"}
          </Button>
        </View>
      </KeyboardAwareScrollViewCompat>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing["2xl"],
    flexGrow: 1,
  },
  infoCard: {
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  infoTitle: {
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  infoText: {
    textAlign: "center",
  },
  form: {
    marginBottom: Spacing["2xl"],
  },
  warningCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.md,
    marginBottom: Spacing["2xl"],
  },
  footer: {
    marginTop: "auto",
  },
});
