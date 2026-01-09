import { useState, useMemo, useEffect, useCallback } from "react";
import { View, StyleSheet, Pressable, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { NetworkBadge } from "@/components/NetworkBadge";
import { useWallet } from "@/lib/wallet-context";
import { usePortfolio } from "@/hooks/usePortfolio";
import { NETWORKS } from "@/lib/types";
import {
  sendNative,
  sendERC20,
  estimateNativeGas,
  estimateERC20Gas,
  GasEstimate,
} from "@/lib/blockchain/transactions";
import { saveTransaction } from "@/lib/transaction-history";
import { getExplorerTxUrl } from "@/lib/blockchain/chains";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Send">;

type RiskLevel = "low" | "medium" | "high" | "blocked";

interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
  canProceed: boolean;
}

interface TokenOption {
  symbol: string;
  balance: string;
  address?: `0x${string}`;
  decimals: number;
  isNative: boolean;
}

export default function SendScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { activeWallet, selectedNetwork, policySettings } = useWallet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [isSending, setIsSending] = useState(false);
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [gasLoading, setGasLoading] = useState(false);
  const [gasError, setGasError] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<{ hash: string; explorerUrl: string } | null>(null);

  const chainId = NETWORKS[selectedNetwork].chainId;

  const { assets } = usePortfolio(activeWallet?.address, selectedNetwork);

  const tokens: TokenOption[] = useMemo(() => {
    return assets.map((asset) => ({
      symbol: asset.symbol,
      balance: asset.balance,
      address: asset.isNative ? undefined : (asset.address as `0x${string}`),
      decimals: asset.decimals,
      isNative: asset.isNative,
    }));
  }, [assets]);

  useEffect(() => {
    if (tokens.length > 0 && !selectedToken) {
      const preselected = route.params?.tokenSymbol;
      if (preselected && tokens.find(t => t.symbol === preselected)) {
        setSelectedToken(preselected);
      } else {
        setSelectedToken(tokens[0].symbol);
      }
    }
  }, [tokens, selectedToken, route.params?.tokenSymbol]);

  const selectedTokenData = tokens.find(t => t.symbol === selectedToken);

  const estimateGas = useCallback(async () => {
    if (!activeWallet || !recipient || !amount || !selectedTokenData) return;
    if (!recipient.startsWith("0x") || recipient.length !== 42) return;
    
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    setGasLoading(true);
    setGasError(null);

    try {
      let estimate: GasEstimate;
      
      if (selectedTokenData.isNative) {
        estimate = await estimateNativeGas(
          chainId,
          activeWallet.address as `0x${string}`,
          recipient as `0x${string}`,
          amount
        );
      } else {
        estimate = await estimateERC20Gas(
          chainId,
          activeWallet.address as `0x${string}`,
          selectedTokenData.address!,
          recipient as `0x${string}`,
          amount,
          selectedTokenData.decimals
        );
      }

      setGasEstimate(estimate);
    } catch (error) {
      console.error("Gas estimation failed:", error);
      setGasError("Could not estimate fee. Transaction may fail.");
    } finally {
      setGasLoading(false);
    }
  }, [activeWallet, recipient, amount, selectedTokenData, chainId]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      estimateGas();
    }, 500);
    return () => clearTimeout(timeout);
  }, [estimateGas]);

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

    const balance = parseFloat(selectedTokenData?.balance.replace(",", "") || "0");
    const sendAmount = parseFloat(amount);
    if (sendAmount > balance) {
      reasons.push("Insufficient balance");
      level = "blocked";
      canProceed = false;
    }

    if (sendAmount > 10000) {
      reasons.push("Large transaction - extra caution advised");
      if (level === "low") level = "medium";
    }

    return { level, reasons, canProceed };
  }, [recipient, amount, policySettings, selectedTokenData]);

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

  const handleSend = async () => {
    if (!activeWallet || !selectedTokenData) return;

    setIsSending(true);

    try {
      let result;

      if (selectedTokenData.isNative) {
        result = await sendNative({
          chainId,
          walletId: activeWallet.id,
          to: recipient as `0x${string}`,
          amountNative: amount,
        });
      } else {
        result = await sendERC20({
          chainId,
          walletId: activeWallet.id,
          tokenAddress: selectedTokenData.address!,
          tokenDecimals: selectedTokenData.decimals,
          to: recipient as `0x${string}`,
          amount,
        });
      }

      await saveTransaction({
        chainId,
        walletAddress: activeWallet.address,
        hash: result.hash,
        type: selectedTokenData.isNative ? "native" : "erc20",
        tokenAddress: selectedTokenData.address,
        tokenSymbol: selectedTokenData.symbol,
        to: recipient,
        amount,
        explorerUrl: result.explorerUrl,
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTxSuccess({ hash: result.hash, explorerUrl: result.explorerUrl });
    } catch (error) {
      console.error("Transaction failed:", error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Transaction Failed",
        error instanceof Error ? error.message : "An unexpected error occurred"
      );
    } finally {
      setIsSending(false);
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

    const feeText = gasEstimate 
      ? `Gas Fee: ~${gasEstimate.estimatedFeeFormatted}`
      : "Gas Fee: Estimating...";

    Alert.alert(
      "Wallet Firewall - Before You Sign",
      `Transaction Summary:\n\nSending: ${amount} ${selectedToken}\nTo: ${recipient.slice(0, 10)}...${recipient.slice(-4)}\nNetwork: ${NETWORKS[selectedNetwork].name}\n${feeText}\n\nRisk Level: ${getRiskLabel(riskAssessment.level)}${warningText}`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: riskAssessment.level === "high" ? "I Understand, Send" : "Confirm Send",
          style: riskAssessment.level === "high" ? "destructive" : "default",
          onPress: handleSend
        },
      ]
    );
  };

  const handleCopyHash = async () => {
    if (txSuccess) {
      await Clipboard.setStringAsync(txSuccess.hash);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleViewExplorer = async () => {
    if (txSuccess) {
      await WebBrowser.openBrowserAsync(txSuccess.explorerUrl);
    }
  };

  if (txSuccess) {
    return (
      <ThemedView style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <View style={[styles.successCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[styles.successIcon, { backgroundColor: theme.success + "20" }]}>
            <Feather name="check-circle" size={48} color={theme.success} />
          </View>
          <ThemedText type="h2" style={{ textAlign: "center" }}>
            Transaction Sent
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>
            Your transaction has been broadcast to the network
          </ThemedText>

          <View style={styles.hashContainer}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Transaction Hash
            </ThemedText>
            <Pressable onPress={handleCopyHash} style={styles.hashRow}>
              <ThemedText type="small" style={{ fontFamily: "monospace" }}>
                {txSuccess.hash.slice(0, 16)}...{txSuccess.hash.slice(-8)}
              </ThemedText>
              <Feather name="copy" size={14} color={theme.accent} />
            </Pressable>
          </View>

          <View style={styles.successButtons}>
            <Button onPress={handleViewExplorer} style={{ flex: 1 }}>
              View on Explorer
            </Button>
            <Pressable
              style={[styles.doneButton, { borderColor: theme.border }]}
              onPress={() => navigation.goBack()}
            >
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                Done
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </ThemedView>
    );
  }

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
              {tokens.slice(0, 3).map((token) => (
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
            {gasLoading ? (
              <ActivityIndicator size="small" color={theme.accent} />
            ) : gasError ? (
              <ThemedText type="small" style={{ color: theme.warning }}>
                Unable to estimate
              </ThemedText>
            ) : gasEstimate ? (
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                ~{gasEstimate.estimatedFeeFormatted}
              </ThemedText>
            ) : (
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Enter amount to estimate
              </ThemedText>
            )}
          </View>
          {gasError ? (
            <View style={styles.feeRow}>
              <ThemedText type="caption" style={{ color: theme.warning }}>
                {gasError}
              </ThemedText>
              <Pressable onPress={estimateGas}>
                <ThemedText type="small" style={{ color: theme.accent }}>Retry</ThemedText>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={[styles.policyCard, { backgroundColor: theme.accent + "10" }]}>
          <Feather name="shield" size={16} color={theme.accent} />
          <ThemedText type="caption" style={{ color: theme.accent, flex: 1 }}>
            Wallet Firewall is active. Transactions are reviewed before signing.
          </ThemedText>
        </View>

        <View style={styles.footer}>
          <Button 
            onPress={handleReview} 
            disabled={isSending || !riskAssessment.canProceed || !selectedTokenData}
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
  successCard: {
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    gap: Spacing.lg,
    marginHorizontal: Spacing.lg,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  hashContainer: {
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.lg,
    width: "100%",
  },
  hashRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  successButtons: {
    flexDirection: "column",
    gap: Spacing.md,
    width: "100%",
  },
  doneButton: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
  },
});
