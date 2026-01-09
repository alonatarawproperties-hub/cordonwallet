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
import { validateMnemonic, deriveAddress } from "@/lib/wallet-engine";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "ImportWallet">;

export default function ImportWalletScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const [walletName, setWalletName] = useState("Imported Wallet");
  const [seedPhrase, setSeedPhrase] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [previewAddress, setPreviewAddress] = useState<string | null>(null);

  const handleValidate = () => {
    const normalizedPhrase = seedPhrase.trim().toLowerCase().replace(/\s+/g, " ");
    const words = normalizedPhrase.split(" ");
    
    if (words.length !== 12 && words.length !== 24) {
      setPreviewAddress(null);
      return;
    }

    if (validateMnemonic(normalizedPhrase)) {
      try {
        const address = deriveAddress(normalizedPhrase);
        setPreviewAddress(address);
      } catch {
        setPreviewAddress(null);
      }
    } else {
      setPreviewAddress(null);
    }
  };

  const handleSeedPhraseChange = (text: string) => {
    setSeedPhrase(text);
    setPreviewAddress(null);
  };

  const handleImport = async () => {
    if (!walletName.trim()) {
      Alert.alert("Error", "Please enter a wallet name");
      return;
    }

    const normalizedPhrase = seedPhrase.trim().toLowerCase().replace(/\s+/g, " ");
    const words = normalizedPhrase.split(" ");
    
    if (words.length !== 12 && words.length !== 24) {
      Alert.alert("Error", "Please enter a valid 12 or 24 word seed phrase");
      return;
    }

    if (!validateMnemonic(normalizedPhrase)) {
      Alert.alert("Invalid Seed Phrase", "One or more words in your seed phrase are invalid. Please check and try again.");
      return;
    }

    setIsValidating(true);
    
    try {
      navigation.navigate("SetupPin", { 
        mnemonic: normalizedPhrase, 
        walletName: walletName.trim(),
        isImport: true 
      });
    } catch (error) {
      Alert.alert("Error", "Failed to validate seed phrase. Please try again.");
    } finally {
      setIsValidating(false);
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
              onChangeText={handleSeedPhraseChange}
              onBlur={handleValidate}
              placeholder="Enter your 12 or 24 word seed phrase..."
              multiline
              numberOfLines={4}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.multilineInput}
            />
          </View>

          {previewAddress ? (
            <View style={[styles.previewCard, { backgroundColor: theme.success + "15", borderColor: theme.success + "40" }]}>
              <Feather name="check-circle" size={20} color={theme.success} />
              <View style={{ flex: 1 }}>
                <ThemedText type="small" style={{ color: theme.success }}>
                  Valid seed phrase detected
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 4 }}>
                  Address: {previewAddress.slice(0, 10)}...{previewAddress.slice(-8)}
                </ThemedText>
              </View>
            </View>
          ) : null}
        </View>

        <View style={[styles.warningCard, { backgroundColor: theme.danger + "15", borderColor: theme.danger + "40" }]}>
          <Feather name="lock" size={20} color={theme.danger} />
          <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>
            Your seed phrase is never sent to our servers. It stays encrypted on your device.
          </ThemedText>
        </View>

        <View style={styles.footer}>
          <Button onPress={handleImport} disabled={isValidating || !seedPhrase.trim()}>
            {isValidating ? "Validating..." : "Import Wallet"}
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
  previewCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.md,
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
