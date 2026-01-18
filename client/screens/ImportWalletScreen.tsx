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
import { validateMnemonic, deriveAddress, hasDevicePin, isUnlocked, addWalletToExistingVault, addWalletFromPrivateKey } from "@/lib/wallet-engine";
import { useWallet } from "@/lib/wallet-context";
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

type ImportMethod = "seed" | "private";
type PrivateKeyChain = "evm" | "solana";

export default function ImportWalletScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { addWallet } = useWallet();
  const [walletName, setWalletName] = useState("Imported Wallet");
  const [walletType, setWalletType] = useState<WalletType>("multi-chain");
  const [seedPhrase, setSeedPhrase] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [previewAddress, setPreviewAddress] = useState<string | null>(null);
  
  const [importMethod, setImportMethod] = useState<ImportMethod>("seed");
  const [pkChain, setPkChain] = useState<PrivateKeyChain>("evm");
  const [privateKey, setPrivateKey] = useState("");
  const [pkError, setPkError] = useState<string | null>(null);
  const [pkPreviewAddress, setPkPreviewAddress] = useState<string | null>(null);
  const [showPkHelp, setShowPkHelp] = useState(false);

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

  const handleImportMethodChange = async (method: ImportMethod) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setImportMethod(method);
    setPkError(null);
    setPkPreviewAddress(null);
  };

  const handlePkChainChange = async (chain: PrivateKeyChain) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPkChain(chain);
    setPkError(null);
    setPkPreviewAddress(null);
    setPrivateKey("");
  };

  const validatePrivateKey = (key: string, chain: PrivateKeyChain): { valid: boolean; address?: string; error?: string } => {
    if (!key.trim()) {
      return { valid: false };
    }

    if (chain === "evm") {
      let pkHex = key.trim();
      if (pkHex.startsWith("0x")) {
        pkHex = pkHex.slice(2);
      }
      if (!/^[0-9a-fA-F]{64}$/.test(pkHex)) {
        return { valid: false, error: "Invalid EVM private key. Must be 64 hex characters (with or without 0x prefix)." };
      }
      try {
        const { privateKeyToAccount } = require("viem/accounts");
        const account = privateKeyToAccount(`0x${pkHex.toLowerCase()}`);
        return { valid: true, address: account.address };
      } catch {
        return { valid: false, error: "Failed to derive address from private key." };
      }
    } else {
      const trimmedKey = key.trim();
      try {
        let secretKeyBytes: Uint8Array;
        
        if (trimmedKey.startsWith("[")) {
          const numbers: number[] = JSON.parse(trimmedKey);
          if (!Array.isArray(numbers) || numbers.length !== 64) {
            return { valid: false, error: "Invalid Solana key: JSON array must have exactly 64 numbers." };
          }
          if (!numbers.every(n => typeof n === "number" && n >= 0 && n <= 255)) {
            return { valid: false, error: "Invalid Solana key: each number must be 0-255." };
          }
          secretKeyBytes = Uint8Array.from(numbers);
        } else {
          const bs58 = require("bs58").default;
          secretKeyBytes = bs58.decode(trimmedKey);
        }
        
        if (secretKeyBytes.length !== 64) {
          return { valid: false, error: `Invalid Solana secret key length: expected 64 bytes, got ${secretKeyBytes.length}.` };
        }
        
        const nacl = require("tweetnacl");
        const bs58 = require("bs58").default;
        const keypair = nacl.sign.keyPair.fromSecretKey(secretKeyBytes);
        const address = bs58.encode(keypair.publicKey);
        return { valid: true, address };
      } catch (e) {
        if (e instanceof SyntaxError) {
          return { valid: false, error: "Invalid JSON format for Solana secret key." };
        }
        return { valid: false, error: "Invalid Solana secret key format." };
      }
    }
  };

  const handlePrivateKeyChange = (text: string) => {
    setPrivateKey(text);
    setPkError(null);
    setPkPreviewAddress(null);
  };

  const handlePrivateKeyBlur = () => {
    if (!privateKey.trim()) {
      return;
    }
    const result = validatePrivateKey(privateKey, pkChain);
    if (result.valid && result.address) {
      setPkPreviewAddress(result.address);
      setPkError(null);
    } else if (result.error) {
      setPkError(result.error);
      setPkPreviewAddress(null);
    }
  };

  const handlePrivateKeyImport = async () => {
    if (!walletName.trim()) {
      Alert.alert("Error", "Please enter a wallet name");
      return;
    }

    const result = validatePrivateKey(privateKey, pkChain);
    if (!result.valid) {
      setPkError(result.error || "Invalid private key");
      return;
    }

    setIsValidating(true);

    try {
      const pinExists = await hasDevicePin();
      
      if (!pinExists) {
        Alert.alert(
          "PIN Required",
          "Please create a wallet first to set up your device PIN, then import this private key.",
          [{ text: "OK", style: "default" }]
        );
        setIsValidating(false);
        return;
      }
      
      if (!isUnlocked()) {
        Alert.alert(
          "Unlock Required",
          "Please unlock your wallet first, then try importing again.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Unlock", onPress: () => navigation.navigate("Unlock") }
          ]
        );
        setIsValidating(false);
        return;
      }

      const wallet = await addWalletFromPrivateKey(privateKey, pkChain, walletName.trim());
      await addWallet({
        id: wallet.id,
        name: wallet.name,
        address: wallet.address,
        addresses: wallet.addresses,
        walletType: wallet.walletType,
        createdAt: wallet.createdAt,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.reset({
        index: 0,
        routes: [{ name: "Main" }],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to import wallet. Please try again.";
      Alert.alert("Error", message);
    } finally {
      setIsValidating(false);
    }
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
      const pinExists = await hasDevicePin();
      
      if (__DEV__) {
        console.log("[ImportWallet] hasDevicePin:", pinExists, "isUnlocked:", isUnlocked());
      }
      
      if (!pinExists) {
        if (__DEV__) {
          console.log("[ImportWallet] Route: SetupPin (first time PIN creation)");
        }
        navigation.navigate("SetupPin", { 
          mnemonic: normalizedPhrase, 
          walletName: walletName.trim(),
          isImport: true,
          walletType,
        });
      } else if (isUnlocked()) {
        if (__DEV__) {
          console.log("[ImportWallet] Route: Direct import (vault already unlocked)");
        }
        const wallet = await addWalletToExistingVault(normalizedPhrase, walletName.trim(), walletType);
        await addWallet({
          id: wallet.id,
          name: wallet.name,
          address: wallet.address,
          addresses: wallet.addresses,
          walletType: wallet.walletType,
          createdAt: wallet.createdAt,
        });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.reset({
          index: 0,
          routes: [{ name: "Main" }],
        });
      } else {
        if (__DEV__) {
          console.log("[ImportWallet] Route: Unlock required (PIN exists but locked)");
        }
        Alert.alert(
          "Unlock Required",
          "Please unlock your wallet first, then try importing again.",
          [
            { text: "Cancel", style: "cancel" },
            { 
              text: "Unlock", 
              onPress: () => navigation.navigate("Unlock")
            }
          ]
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to import wallet. Please try again.";
      Alert.alert("Error", message);
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
            {importMethod === "seed" 
              ? "Enter your 12 or 24 word seed phrase to import your existing wallet."
              : "Enter your private key to import a single-chain wallet."}
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText type="small" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
            Import Method
          </ThemedText>
          <View style={[styles.segmentedControl, { backgroundColor: theme.backgroundDefault }]}>
            <Pressable
              style={[
                styles.segmentButton,
                importMethod === "seed" && { backgroundColor: theme.accent }
              ]}
              onPress={() => handleImportMethodChange("seed")}
            >
              <ThemedText 
                type="small" 
                style={{ 
                  color: importMethod === "seed" ? "#fff" : theme.textSecondary,
                  fontWeight: "600"
                }}
              >
                Seed Phrase
              </ThemedText>
            </Pressable>
            <Pressable
              style={[
                styles.segmentButton,
                importMethod === "private" && { backgroundColor: theme.accent }
              ]}
              onPress={() => handleImportMethodChange("private")}
            >
              <ThemedText 
                type="small" 
                style={{ 
                  color: importMethod === "private" ? "#fff" : theme.textSecondary,
                  fontWeight: "600"
                }}
              >
                Private Key
              </ThemedText>
            </Pressable>
          </View>
        </View>

        {importMethod === "seed" ? (
          <>
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
          </>
        ) : (
          <>
            <View style={styles.section}>
              <ThemedText type="small" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                Chain Type
              </ThemedText>
              <View style={[styles.segmentedControl, { backgroundColor: theme.backgroundDefault }]}>
                <Pressable
                  style={[
                    styles.segmentButton,
                    pkChain === "evm" && { backgroundColor: theme.accent }
                  ]}
                  onPress={() => handlePkChainChange("evm")}
                >
                  <ThemedText 
                    type="small" 
                    style={{ 
                      color: pkChain === "evm" ? "#fff" : theme.textSecondary,
                      fontWeight: "600"
                    }}
                  >
                    EVM (ETH/POL/BNB)
                  </ThemedText>
                </Pressable>
                <Pressable
                  style={[
                    styles.segmentButton,
                    pkChain === "solana" && { backgroundColor: theme.accent }
                  ]}
                  onPress={() => handlePkChainChange("solana")}
                >
                  <ThemedText 
                    type="small" 
                    style={{ 
                      color: pkChain === "solana" ? "#fff" : theme.textSecondary,
                      fontWeight: "600"
                    }}
                  >
                    Solana (SOL)
                  </ThemedText>
                </Pressable>
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
                  label={pkChain === "solana" ? "Secret Key (Solana)" : "Private Key (EVM)"}
                  value={privateKey}
                  onChangeText={handlePrivateKeyChange}
                  onBlur={handlePrivateKeyBlur}
                  placeholder={pkChain === "evm" 
                    ? "Paste your EVM private key (64 hex characters, with or without 0x)" 
                    : "Paste your Solana secret key (usually a long Base58 string)"}
                  multiline
                  numberOfLines={4}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={false}
                  style={styles.multilineInput}
                />
              </View>

              <Pressable
                onPress={() => setShowPkHelp(v => !v)}
                style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}
                hitSlop={10}
              >
                <Feather name="help-circle" size={16} color={theme.textSecondary} />
                <ThemedText
                  type="small"
                  style={{ color: theme.textSecondary, marginLeft: 8, textDecorationLine: "underline" }}
                >
                  Where do I find this?
                </ThemedText>
              </Pressable>

              {showPkHelp ? (
                <View style={[styles.previewCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border + "60" }]}>
                  <Feather name="info" size={18} color={theme.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <ThemedText type="small" style={{ color: theme.text, fontWeight: "600" }}>
                      {pkChain === "solana" ? "Solana secret key formats" : "EVM private key format"}
                    </ThemedText>

                    {pkChain === "solana" ? (
                      <>
                        <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 6 }}>
                          Most wallets export a long Base58 "Secret Key".
                        </ThemedText>
                        <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 4 }}>
                          Dev tools may export a JSON array like [12,34,...]. We accept both.
                        </ThemedText>
                      </>
                    ) : (
                      <>
                        <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 6 }}>
                          64 hex characters (sometimes starts with 0x). Example: 0xabc...
                        </ThemedText>
                        <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 4 }}>
                          Never share this with anyone.
                        </ThemedText>
                      </>
                    )}
                  </View>
                </View>
              ) : null}

              {pkError ? (
                <View style={[styles.previewCard, { backgroundColor: theme.danger + "15", borderColor: theme.danger + "40" }]}>
                  <Feather name="alert-circle" size={20} color={theme.danger} />
                  <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>
                    {pkError}
                  </ThemedText>
                </View>
              ) : null}

              {pkPreviewAddress ? (
                <View style={[styles.previewCard, { backgroundColor: theme.success + "15", borderColor: theme.success + "40" }]}>
                  <Feather name="check-circle" size={20} color={theme.success} />
                  <View style={{ flex: 1 }}>
                    <ThemedText type="small" style={{ color: theme.success }}>
                      Valid private key detected
                    </ThemedText>
                    <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 4 }}>
                      Address: {pkPreviewAddress.slice(0, 10)}...{pkPreviewAddress.slice(-8)}
                    </ThemedText>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={[styles.warningCard, { backgroundColor: theme.danger + "15", borderColor: theme.danger + "40" }]}>
              <Feather name="lock" size={20} color={theme.danger} />
              <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>
                Your private key is never sent to our servers. It stays encrypted on your device.
              </ThemedText>
            </View>

            <View style={styles.footer}>
              <Button onPress={handlePrivateKeyImport} disabled={isValidating || !privateKey.trim() || !!pkError}>
                {isValidating ? "Importing..." : "Import Wallet"}
              </Button>
            </View>
          </>
        )}
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
  segmentedControl: {
    flexDirection: "row",
    borderRadius: BorderRadius.md,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
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
