import { useState } from "react";
import { View, StyleSheet, Alert, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { validateMnemonic, deriveAddress } from "@/lib/wallet-engine";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { WalletType } from "@/lib/types";

type Props = NativeStackScreenProps<RootStackParamList, "ImportWallet">;

interface WalletTypeOption {
  id: WalletType;
  title: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  chains: string[];
}

const walletTypeOptions: WalletTypeOption[] = [
  {
    id: "multi-chain",
    title: "Multi-Chain Wallet",
    description: "Support for Ethereum, Polygon, BSC, and Solana",
    icon: "layers",
    chains: ["ETH", "MATIC", "BNB", "SOL"],
  },
  {
    id: "solana-only",
    title: "Solana Only",
    description: "Optimized for Solana ecosystem",
    icon: "sun",
    chains: ["SOL"],
  },
];

function getChainColor(chain: string): string {
  const colors: Record<string, string> = {
    ETH: "#627EEA",
    MATIC: "#8247E5",
    BNB: "#F3BA2F",
    SOL: "#9945FF",
  };
  return colors[chain] || "#888";
}

export default function ImportWalletScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const [walletName, setWalletName] = useState("Imported Wallet");
  const [walletType, setWalletType] = useState<WalletType>("multi-chain");
  const [seedPhrase, setSeedPhrase] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [previewAddress, setPreviewAddress] = useState<string | null>(null);

  const handleSelectType = async (type: WalletType) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setWalletType(type);
  };

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
        isImport: true,
        walletType,
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

        <View style={styles.section}>
          <ThemedText type="small" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
            Wallet Type
          </ThemedText>
          <View style={styles.typeOptions}>
            {walletTypeOptions.map((option) => {
              const isSelected = walletType === option.id;
              return (
                <Pressable
                  key={option.id}
                  style={[
                    styles.typeOption,
                    { 
                      backgroundColor: theme.backgroundDefault,
                      borderColor: isSelected ? theme.accent : theme.border,
                      borderWidth: isSelected ? 2 : 1,
                    }
                  ]}
                  onPress={() => handleSelectType(option.id)}
                >
                  <View style={styles.typeOptionHeader}>
                    <View style={[
                      styles.typeIconContainer, 
                      { backgroundColor: isSelected ? theme.accent + "20" : theme.backgroundSecondary }
                    ]}>
                      <Feather 
                        name={option.icon} 
                        size={20} 
                        color={isSelected ? theme.accent : theme.textSecondary} 
                      />
                    </View>
                    <View style={styles.typeInfo}>
                      <ThemedText type="body" style={{ fontWeight: "600" }}>
                        {option.title}
                      </ThemedText>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                        {option.description}
                      </ThemedText>
                    </View>
                    <View style={[
                      styles.radioOuter,
                      { borderColor: isSelected ? theme.accent : theme.border }
                    ]}>
                      {isSelected ? (
                        <View style={[styles.radioInner, { backgroundColor: theme.accent }]} />
                      ) : null}
                    </View>
                  </View>
                  <View style={styles.chainBadges}>
                    {option.chains.map((chain) => (
                      <View 
                        key={chain} 
                        style={[
                          styles.chainBadge, 
                          { backgroundColor: getChainColor(chain) + "20" }
                        ]}
                      >
                        <ThemedText 
                          type="caption" 
                          style={{ color: getChainColor(chain), fontWeight: "600", fontSize: 10 }}
                        >
                          {chain}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
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
    marginBottom: Spacing.xl,
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
  section: {
    marginBottom: Spacing.xl,
  },
  sectionLabel: {
    marginBottom: Spacing.md,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  typeOptions: {
    gap: Spacing.md,
  },
  typeOption: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  typeOptionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  typeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  typeInfo: {
    flex: 1,
    gap: 2,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  chainBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingLeft: 52,
  },
  chainBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  form: {
    marginBottom: Spacing.xl,
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
