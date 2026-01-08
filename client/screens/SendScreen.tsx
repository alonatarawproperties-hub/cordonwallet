import { useState, useMemo } from "react";
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
import { Badge } from "@/components/Badge";
import { useWallet } from "@/lib/wallet-context";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Send">;

type RiskLevel = "low" | "medium" | "high" | "blocked";

interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
  canProceed: boolean;
}

export default function SendScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { activeWallet, selectedNetwork, policySettings } = useWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedToken, setSelectedToken] = useState("ETH");
  const [isSending, setIsSending] = useState(false);

  const tokens = [
    { symbol: "ETH", balance: "2.5421", priceUsd: 1780 },
    { symbol: "USDC", balance: "1,250.00", priceUsd: 1 },
    { symbol: "MATIC", balance: "5,421.32", priceUsd: 0.85 },
  ];

  const selectedTokenData = tokens.find(t => t.symbol === selectedToken);
  const amountUsd = parseFloat(amount || "0") * (selectedTokenData?.priceUsd || 0);

  const riskAssessment = useMemo((): RiskAssessment => {
    const reasons: string[] = [];
    let level: RiskLevel = "low";
    let canProceed = true;

    if (!recipient.trim() || !amount.trim()) {
      return { level: "low", reasons: [], canProceed: true };
    }

    const normalizedRecipient = recipient.toLowerCase();
    
    if (policySettings.denylistedAddresses.some(addr => addr.toLowerCase() === normalizedRecipient)) {
      reasons.push("Recipient is on your denylist");
      level = "blocked";
      canProceed = false;
      return { level, reasons, canProceed };
    }

    const isAllowlisted = policySettings.allowlistedAddresses.some(
      addr => addr.toLowerCase() === normalizedRecipient
    );
    
    if (isAllowlisted) {
      return { level: "low", reasons: ["Recipient is allowlisted - trusted address"], canProceed: true };
    }

    if (!recipient.startsWith("0x") || recipient.length !== 42) {
      reasons.push("Invalid recipient address format");
      level = "high";
      canProceed = false;
      return { level, reasons, canProceed };
    }

    const maxSpend = parseFloat(policySettings.maxSpendPerTransaction) || Infinity;
    const dailyLimit = parseFloat(policySettings.dailySpendLimit) || Infinity;

    if (amountUsd > maxSpend) {
      reasons.push(`Exceeds max per-transaction limit ($${maxSpend})`);
      level = "high";
    }

    if (amountUsd > dailyLimit * 0.5) {
      reasons.push(`Uses more than 50% of daily limit ($${dailyLimit})`);
      if (level === "low") level = "medium";
    }

    const balance = parseFloat(selectedTokenData?.balance.replace(",", "") || "0");
    if (parseFloat(amount) > balance) {
      reasons.push("Insufficient balance");
      level = "blocked";
      canProceed = false;
    }

    if (amountUsd > 10000) {
      reasons.push("Large transaction - extra caution advised");
      if (level === "low") level = "medium";
    }

    return { level, reasons, canProceed };
  }, [recipient, amount, amountUsd, policySettings, selectedTokenData]);

  const getRiskColor = (level: RiskLevel) => {
    switch (level) {
      case "low": return theme.success;
      case "medium": return theme.warning;
      case "high": return theme.danger;
      case "blocked": return theme.danger;
    }
  };

  const getRiskLabel = (level: RiskLevel) => {
    switch (level) {
      case "low": return "Low Risk";
      case "medium": return "Medium Risk";
      case "high": return "High Risk";
      case "blocked": return "Blocked";
    }
  };

  const handleReview = () => {
    if (!recipient.trim()) {
      Alert.alert("Error", "Please enter a recipient address");
      return;
    }
    if (!amount.trim() || parseFloat(amount) <= 0) {
      Alert.alert("Error", "Please enter a valid amount");
      return;
    }

    if (!riskAssessment.canProceed) {
      Alert.alert(
        "Transaction Blocked",
        `This transaction cannot proceed:\n\n${riskAssessment.reasons.join("\n")}`,
        [{ text: "OK" }]
      );
      return;
    }

    const warningText = riskAssessment.reasons.length > 0 
      ? `\n\nWarnings:\n${riskAssessment.reasons.map(r => `- ${r}`).join("\n")}`
      : "";

    Alert.alert(
      "Wallet Firewall - Before You Sign",
      `Transaction Summary:\n\nSending: ${amount} ${selectedToken}\nValue: ~$${amountUsd.toFixed(2)}\nTo: ${recipient.slice(0, 10)}...${recipient.slice(-4)}\nNetwork: ${selectedNetwork}\nGas Fee: ~0.002 ETH (~$3.50)\n\nRisk Level: ${getRiskLabel(riskAssessment.level)}${warningText}`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: riskAssessment.level === "high" ? "I Understand, Send" : "Confirm Send",
          style: riskAssessment.level === "high" ? "destructive" : "default",
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
              <Pressable onPress={() => setAmount(selectedTokenData?.balance.replace(",", "") || "")}>
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
            {amountUsd > 0 ? (
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                ~${amountUsd.toFixed(2)} USD
              </ThemedText>
            ) : null}
          </View>
        </View>

        {riskAssessment.reasons.length > 0 ? (
          <View style={[
            styles.riskCard, 
            { 
              backgroundColor: getRiskColor(riskAssessment.level) + "15",
              borderColor: getRiskColor(riskAssessment.level) + "40",
            }
          ]}>
            <View style={styles.riskHeader}>
              <Feather 
                name={riskAssessment.level === "low" ? "check-circle" : "alert-triangle"} 
                size={20} 
                color={getRiskColor(riskAssessment.level)} 
              />
              <ThemedText type="body" style={{ color: getRiskColor(riskAssessment.level), fontWeight: "600" }}>
                {getRiskLabel(riskAssessment.level)}
              </ThemedText>
            </View>
            {riskAssessment.reasons.map((reason, index) => (
              <ThemedText key={index} type="small" style={{ color: getRiskColor(riskAssessment.level) }}>
                - {reason}
              </ThemedText>
            ))}
          </View>
        ) : null}

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

        <View style={[styles.policyCard, { backgroundColor: theme.accent + "10" }]}>
          <Feather name="shield" size={16} color={theme.accent} />
          <ThemedText type="caption" style={{ color: theme.accent, flex: 1 }}>
            Wallet Firewall is active. Max per-tx: ${policySettings.maxSpendPerTransaction || "No limit"}, Daily: ${policySettings.dailySpendLimit || "No limit"}
          </ThemedText>
        </View>

        <View style={styles.footer}>
          <Button 
            onPress={handleReview} 
            disabled={isSending || !riskAssessment.canProceed}
          >
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
  riskCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  riskHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  feeCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  feeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  policyCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  footer: {
    marginTop: "auto",
  },
});
