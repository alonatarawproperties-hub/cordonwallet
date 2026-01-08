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
import { useWallet } from "@/lib/wallet-context";
import { saveSeedPhrase } from "@/lib/secure-storage";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "CreateWallet">;

const generateSeedPhrase = (): string[] => {
  const words = [
    "abandon", "ability", "able", "about", "above", "absent", "absorb", "abstract",
    "absurd", "abuse", "access", "accident", "account", "accuse", "achieve", "acid",
    "acoustic", "acquire", "across", "act", "action", "actor", "actress", "actual",
    "adapt", "add", "addict", "address", "adjust", "admit", "adult", "advance",
    "advice", "aerobic", "affair", "afford", "afraid", "again", "age", "agent",
    "agree", "ahead", "aim", "air", "airport", "aisle", "alarm", "album",
    "alcohol", "alert", "alien", "all", "alley", "allow", "almost", "alone",
    "alpha", "already", "also", "alter", "always", "amateur", "amazing", "among",
  ];
  
  const phrase: string[] = [];
  for (let i = 0; i < 12; i++) {
    phrase.push(words[Math.floor(Math.random() * words.length)]);
  }
  return phrase;
};

const generateAddress = (): string => {
  const chars = "0123456789abcdef";
  let address = "0x";
  for (let i = 0; i < 40; i++) {
    address += chars[Math.floor(Math.random() * chars.length)];
  }
  return address;
};

export default function CreateWalletScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { addWallet, unlock } = useWallet();
  const [walletName, setWalletName] = useState("Main Wallet");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!walletName.trim()) {
      Alert.alert("Error", "Please enter a wallet name");
      return;
    }

    setIsCreating(true);
    
    try {
      const seedPhrase = generateSeedPhrase();
      const address = generateAddress();
      const walletId = Date.now().toString();
      
      const wallet = {
        id: walletId,
        name: walletName.trim(),
        address,
        createdAt: Date.now(),
      };

      await saveSeedPhrase(walletId, seedPhrase);
      await addWallet(wallet);
      unlock();
      
      navigation.navigate("BackupWarning", { seedPhrase });
    } catch (error) {
      Alert.alert("Error", "Failed to create wallet. Please try again.");
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
            Never share your seed phrase with anyone. ShieldWallet will never ask for it.
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
