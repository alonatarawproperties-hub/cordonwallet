import { useState } from "react";
import { View, StyleSheet, Pressable, Alert } from "react-native";
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

type Props = NativeStackScreenProps<RootStackParamList, "CreateBundle">;

export default function CreateBundleScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { wallets, addBundle } = useWallet();
  const [bundleName, setBundleName] = useState("");
  const [selectedWallets, setSelectedWallets] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  const toggleWallet = (walletId: string) => {
    setSelectedWallets(prev => 
      prev.includes(walletId) 
        ? prev.filter(id => id !== walletId)
        : [...prev, walletId]
    );
  };

  const handleCreate = async () => {
    if (!bundleName.trim()) {
      Alert.alert("Error", "Please enter a bundle name");
      return;
    }
    if (selectedWallets.length === 0) {
      Alert.alert("Error", "Please select at least one wallet");
      return;
    }

    setIsCreating(true);
    try {
      await addBundle({
        id: Date.now().toString(),
        name: bundleName.trim(),
        walletIds: selectedWallets,
        createdAt: Date.now(),
      });
      navigation.goBack();
    } catch (error) {
      Alert.alert("Error", "Failed to create bundle");
    } finally {
      setIsCreating(false);
    }
  };

  const mockWallets = wallets.length > 0 ? wallets : [
    { id: "1", name: "Main Wallet", address: "0x1234...5678" },
    { id: "2", name: "Trading Wallet", address: "0x8765...4321" },
  ];

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
            <Feather name="layers" size={32} color={theme.accent} />
          </View>
          <ThemedText type="h3" style={styles.infoTitle}>
            Create a Bundle
          </ThemedText>
          <ThemedText type="body" style={[styles.infoText, { color: theme.textSecondary }]}>
            Group wallets together to manage them as one unit and perform batch operations.
          </ThemedText>
        </View>

        <View style={styles.form}>
          <Input
            label="Bundle Name"
            value={bundleName}
            onChangeText={setBundleName}
            placeholder="e.g., Trading Wallets"
            autoCapitalize="words"
          />
        </View>

        <View style={styles.walletsSection}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Select Wallets
          </ThemedText>
          
          {mockWallets.map((wallet) => {
            const isSelected = selectedWallets.includes(wallet.id);
            return (
              <Pressable
                key={wallet.id}
                style={[
                  styles.walletCard,
                  { 
                    backgroundColor: theme.backgroundDefault,
                    borderColor: isSelected ? theme.accent : theme.border,
                  }
                ]}
                onPress={() => toggleWallet(wallet.id)}
              >
                <View style={[
                  styles.checkbox,
                  { 
                    borderColor: isSelected ? theme.accent : theme.border,
                    backgroundColor: isSelected ? theme.accent : "transparent",
                  }
                ]}>
                  {isSelected ? <Feather name="check" size={14} color="#FFFFFF" /> : null}
                </View>
                <View style={styles.walletInfo}>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {wallet.name}
                  </ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {wallet.address}
                  </ThemedText>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.footer}>
          <Button 
            onPress={handleCreate} 
            disabled={isCreating || !bundleName.trim() || selectedWallets.length === 0}
          >
            {isCreating ? "Creating..." : "Create Bundle"}
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
  walletsSection: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    marginBottom: Spacing.lg,
  },
  walletCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  walletInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  footer: {
    marginTop: "auto",
  },
});
