import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { addCustomToken } from "@/lib/token-preferences";
import { supportedChains, ChainConfig } from "@/lib/blockchain/chains";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface NetworkOption {
  id: number | string;
  name: string;
  color: string;
}

const networkOptions: NetworkOption[] = [
  ...supportedChains.filter((c: ChainConfig) => !c.isTestnet).map((c: ChainConfig) => ({
    id: c.chainId,
    name: c.name,
    color: c.chainId === 1 ? "#627EEA" : c.chainId === 137 ? "#8247E5" : "#F3BA2F",
  })),
  { id: "solana", name: "Solana", color: "#9945FF" },
];

export default function ImportTokenScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NavigationProp>();

  const [selectedNetwork, setSelectedNetwork] = useState<number | string>(137);
  const [contractAddress, setContractAddress] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [decimals, setDecimals] = useState("18");
  const [isLoading, setIsLoading] = useState(false);
  const [showChainPicker, setShowChainPicker] = useState(false);

  const isSolana = selectedNetwork === "solana";
  const selectedChain = networkOptions.find(n => n.id === selectedNetwork);

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setContractAddress(text);
    }
  };

  const validateEvmAddress = (address: string): boolean => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  const validateSolanaAddress = (address: string): boolean => {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  };

  const validateAddress = (address: string): boolean => {
    if (isSolana) {
      return validateSolanaAddress(address);
    }
    return validateEvmAddress(address);
  };

  const handleImport = async () => {
    if (!validateAddress(contractAddress)) {
      Alert.alert(
        "Invalid Address", 
        isSolana 
          ? "Please enter a valid SPL token mint address." 
          : "Please enter a valid contract address."
      );
      return;
    }
    if (!name.trim()) {
      Alert.alert("Missing Name", "Please enter the token name.");
      return;
    }
    if (!symbol.trim()) {
      Alert.alert("Missing Symbol", "Please enter the token symbol.");
      return;
    }
    const decimalsNum = parseInt(decimals, 10);
    const maxDecimals = isSolana ? 9 : 18;
    if (isNaN(decimalsNum) || decimalsNum < 0 || decimalsNum > maxDecimals) {
      Alert.alert("Invalid Decimals", `Decimals must be between 0 and ${maxDecimals}.`);
      return;
    }

    setIsLoading(true);
    try {
      await addCustomToken({
        chainId: isSolana ? 0 : (selectedNetwork as number),
        contractAddress: isSolana ? contractAddress : contractAddress.toLowerCase(),
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        decimals: decimalsNum,
      });
      Alert.alert("Token Imported", `${symbol.trim().toUpperCase()} has been added successfully.`, [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      Alert.alert("Import Failed", "Could not import the token. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const isFormValid = 
    validateAddress(contractAddress) && 
    name.trim() && 
    symbol.trim() && 
    !isNaN(parseInt(decimals, 10));

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.warningBanner, { backgroundColor: theme.accent + "15" }]}>
          <Feather name="alert-circle" size={18} color={theme.accent} />
          <ThemedText type="caption" style={{ flex: 1, color: theme.textSecondary }}>
            Anyone can create a token, including fake versions of existing tokens. Learn about scams and security risks.
          </ThemedText>
        </View>

        <View style={styles.formGroup}>
          <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
            Network
          </ThemedText>
          <Pressable
            style={[styles.networkSelector, { backgroundColor: theme.backgroundDefault }]}
            onPress={() => setShowChainPicker(!showChainPicker)}
          >
            <ThemedText type="body" style={{ fontWeight: "500" }}>
              {selectedChain?.name || "Select Network"}
            </ThemedText>
            <Feather name="chevron-right" size={20} color={theme.textSecondary} />
          </Pressable>
          {showChainPicker ? (
            <View style={[styles.chainPicker, { backgroundColor: theme.backgroundDefault }]}>
              {networkOptions.map((network) => (
                <Pressable
                  key={network.id.toString()}
                  style={[
                    styles.chainOption,
                    selectedNetwork === network.id && { backgroundColor: theme.accent + "20" },
                  ]}
                  onPress={() => {
                    setSelectedNetwork(network.id);
                    setShowChainPicker(false);
                    if (network.id === "solana") {
                      setDecimals("9");
                    } else {
                      setDecimals("18");
                    }
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: network.color }} />
                    <ThemedText type="body">{network.name}</ThemedText>
                  </View>
                  {selectedNetwork === network.id ? (
                    <Feather name="check" size={18} color={theme.accent} />
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.formGroup}>
          <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
            {isSolana ? "Token Mint Address" : "Contract address"}
          </ThemedText>
          <View style={[styles.addressInput, { backgroundColor: theme.backgroundDefault }]}>
            <TextInput
              style={[styles.textInput, { color: theme.text }]}
              placeholder={isSolana ? "SPL token mint address" : "Contract address"}
              placeholderTextColor={theme.textSecondary}
              value={contractAddress}
              onChangeText={setContractAddress}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable onPress={handlePaste} style={styles.pasteButton}>
              <ThemedText type="body" style={{ color: theme.accent }}>Paste</ThemedText>
            </Pressable>
            <Feather name="copy" size={18} color={theme.textSecondary} />
          </View>
        </View>

        <View style={styles.formGroup}>
          <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
            Name
          </ThemedText>
          <TextInput
            style={[styles.input, { backgroundColor: theme.backgroundDefault, color: theme.text }]}
            placeholder="Token name"
            placeholderTextColor={theme.textSecondary}
            value={name}
            onChangeText={setName}
          />
        </View>

        <View style={styles.formGroup}>
          <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
            Symbol
          </ThemedText>
          <TextInput
            style={[styles.input, { backgroundColor: theme.backgroundDefault, color: theme.text }]}
            placeholder="Token symbol"
            placeholderTextColor={theme.textSecondary}
            value={symbol}
            onChangeText={setSymbol}
            autoCapitalize="characters"
          />
        </View>

        <View style={styles.formGroup}>
          <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
            Decimals
          </ThemedText>
          <TextInput
            style={[styles.input, { backgroundColor: theme.backgroundDefault, color: theme.text }]}
            placeholder="18"
            placeholderTextColor={theme.textSecondary}
            value={decimals}
            onChangeText={setDecimals}
            keyboardType="number-pad"
          />
        </View>
      </ScrollView>

      <View style={[styles.bottomContainer, { paddingBottom: insets.bottom + Spacing.md, backgroundColor: theme.backgroundRoot }]}>
        <Button
          onPress={handleImport}
          disabled={!isFormValid || isLoading}
          style={{ opacity: isFormValid && !isLoading ? 1 : 0.5 }}
        >
          <ThemedText type="body" style={{ color: "#FFF", fontWeight: "600" }}>
            {isLoading ? "Importing..." : "Import"}
          </ThemedText>
        </Button>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.md,
  },
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: 12,
    marginBottom: Spacing.lg,
  },
  formGroup: {
    marginBottom: Spacing.lg,
  },
  networkSelector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
    borderRadius: 12,
  },
  chainPicker: {
    marginTop: Spacing.sm,
    borderRadius: 12,
    overflow: "hidden",
  },
  chainOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
  },
  addressInput: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: 12,
    gap: Spacing.sm,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
  },
  pasteButton: {
    paddingHorizontal: Spacing.sm,
  },
  input: {
    padding: Spacing.md,
    borderRadius: 12,
    fontSize: 16,
  },
  bottomContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
});
