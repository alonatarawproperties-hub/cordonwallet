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
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "ImportWallet">;

const generateAddress = (): string => {
  const chars = "0123456789abcdef";
  let address = "0x";
  for (let i = 0; i < 40; i++) {
    address += chars[Math.floor(Math.random() * chars.length)];
  }
  return address;
};

export default function ImportWalletScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { addWallet, unlock } = useWallet();
  const [walletName, setWalletName] = useState("Imported Wallet");
  const [seedPhrase, setSeedPhrase] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  const handleImport = async () => {
    if (!walletName.trim()) {
      Alert.alert("Error", "Please enter a wallet name");
      return;
    }

    const words = seedPhrase.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      Alert.alert("Error", "Please enter a valid 12 or 24 word seed phrase");
      return;
    }

    setIsImporting(true);
    
    try {
      const address = generateAddress();
      
      const wallet = {
        id: Date.now().toString(),
        name: walletName.trim(),
        address,
        createdAt: Date.now(),
      };

      await addWallet(wallet);
      unlock();
      
      navigation.reset({
        index: 0,
        routes: [{ name: "Main" }],
      });
    } catch (error) {
      Alert.alert("Error", "Failed to import wallet. Please try again.");
    } finally {
      setIsImporting(false);
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
          <View style={[styles.iconContainer, { backgroundColor: theme.success + "20" }]}>
            <Feather name="download" size={32} color={theme.success} />
          </View>
          <ThemedText type="h3" style={styles.infoTitle}>
            Import Your Wallet
          </ThemedText>
          <ThemedText type="body" style={[styles.infoText, { color: theme.textSecondary }]}>
            Enter your 12 or 24 word seed phrase to import your existing wallet.
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
          
          <View style={styles.seedInput}>
            <Input
              label="Seed Phrase"
              value={seedPhrase}
              onChangeText={setSeedPhrase}
              placeholder="Enter your 12 or 24 word seed phrase..."
              multiline
              numberOfLines={4}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.multilineInput}
            />
          </View>
        </View>

        <View style={[styles.warningCard, { backgroundColor: theme.danger + "15", borderColor: theme.danger + "40" }]}>
          <Feather name="lock" size={20} color={theme.danger} />
          <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>
            Your seed phrase is never sent to our servers. It stays encrypted on your device.
          </ThemedText>
        </View>

        <View style={styles.footer}>
          <Button onPress={handleImport} disabled={isImporting || !seedPhrase.trim()}>
            {isImporting ? "Importing..." : "Import Wallet"}
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
    gap: Spacing.lg,
  },
  seedInput: {
    marginTop: Spacing.sm,
  },
  multilineInput: {
    height: 100,
    textAlignVertical: "top",
    paddingTop: Spacing.md,
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
