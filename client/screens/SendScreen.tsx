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
import { NetworkBadge } from "@/components/NetworkBadge";
import { useWallet } from "@/lib/wallet-context";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Send">;

export default function SendScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { activeWallet, selectedNetwork } = useWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedToken, setSelectedToken] = useState("ETH");
  const [isSending, setIsSending] = useState(false);

  const tokens = [
    { symbol: "ETH", balance: "2.5421" },
    { symbol: "USDC", balance: "1,250.00" },
    { symbol: "MATIC", balance: "5,421.32" },
  ];

  const handleReview = () => {
    if (!recipient.trim()) {
      Alert.alert("Error", "Please enter a recipient address");
      return;
    }
    if (!amount.trim() || parseFloat(amount) <= 0) {
      Alert.alert("Error", "Please enter a valid amount");
      return;
    }

    Alert.alert(
      "Before You Sign",
      `You are about to send ${amount} ${selectedToken} to ${recipient.slice(0, 10)}...\n\nGas Fee: ~0.002 ETH\nRisk Level: Low`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Send",
          onPress: async () => {
            setIsSending(true);
            setTimeout(() => {
              setIsSending(false);
              navigation.goBack();
              Alert.alert("Success", "Transaction submitted successfully!");
            }, 1500);
          }
        },
      ]
    );
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing["2xl"] },
        ]}
      >
        <View style={[styles.networkCard, { backgroundColor: theme.backgroundDefault }]}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Sending on
          </ThemedText>
          <NetworkBadge networkId={selectedNetwork} selected />
        </View>

        <View style={styles.form}>
          <Input
            label="Recipient Address"
            value={recipient}
            onChangeText={setRecipient}
            placeholder="0x..."
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.tokenSelector}>
            <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
              Token
            </ThemedText>
            <View style={styles.tokenButtons}>
              {tokens.map((token) => (
                <Pressable
                  key={token.symbol}
                  style={[
                    styles.tokenButton,
                    { 
                      backgroundColor: selectedToken === token.symbol ? theme.accent + "20" : theme.backgroundDefault,
                      borderColor: selectedToken === token.symbol ? theme.accent : theme.border,
                    }
                  ]}
                  onPress={() => setSelectedToken(token.symbol)}
                >
                  <ThemedText 
                    type="body" 
                    style={{ 
                      fontWeight: "600",
                      color: selectedToken === token.symbol ? theme.accent : theme.text,
                    }}
                  >
                    {token.symbol}
                  </ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {token.balance}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.amountSection}>
            <View style={styles.amountHeader}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Amount
              </ThemedText>
              <Pressable onPress={() => setAmount(tokens.find(t => t.symbol === selectedToken)?.balance.replace(",", "") || "")}>
                <ThemedText type="small" style={{ color: theme.accent }}>
                  Max
                </ThemedText>
              </Pressable>
            </View>
            <Input
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        <View style={[styles.feeCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.feeRow}>
            <ThemedText type="body">Estimated Gas Fee</ThemedText>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              ~0.002 ETH
            </ThemedText>
          </View>
          <View style={styles.feeRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Network
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              ~$3.50
            </ThemedText>
          </View>
        </View>

        <View style={styles.footer}>
          <Button onPress={handleReview} disabled={isSending}>
            {isSending ? "Sending..." : "Review Transaction"}
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
  networkCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xl,
  },
  form: {
    gap: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  tokenSelector: {
    gap: Spacing.sm,
  },
  tokenButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  tokenButton: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    alignItems: "center",
    gap: Spacing.xs,
  },
  amountSection: {
    gap: Spacing.sm,
  },
  amountHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  feeCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  feeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footer: {
    marginTop: "auto",
  },
});
