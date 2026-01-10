import { useState, useCallback, useEffect } from "react";
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
import { useWallet } from "@/lib/wallet-context";
import {
  sendNative,
  sendERC20,
  estimateNativeGas,
  estimateERC20Gas,
  GasEstimate,
  TransactionFailedError,
} from "@/lib/blockchain/transactions";
import { sendSol, sendSplToken } from "@/lib/solana/transactions";
import { getMnemonic } from "@/lib/wallet-engine";
import { saveTransaction } from "@/lib/transaction-history";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "SendDetails">;

type RiskLevel = "low" | "medium" | "high" | "blocked";

interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
  canProceed: boolean;
}

function isValidSolanaAddress(address: string): boolean {
  if (!address || address.length < 32 || address.length > 44) return false;
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  return base58Regex.test(address);
}

function isValidEvmAddress(address: string): boolean {
  return address.startsWith("0x") && address.length === 42;
}

export default function SendDetailsScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { activeWallet, policySettings } = useWallet();
  const params = route.params;

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [gasLoading, setGasLoading] = useState(false);
  const [gasError, setGasError] = useState<string | null>(null);
  const [txSuccess, setTxSuccess] = useState<{ hash: string; explorerUrl: string } | null>(null);

  const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address || "";
  const solanaAddress = activeWallet?.addresses?.solana || "";

  const estimateGas = useCallback(async () => {
    if (params.chainType === "solana") {
      setGasEstimate({
        gasLimit: BigInt(5000),
        maxFeePerGas: BigInt(1),
        maxPriorityFeePerGas: BigInt(1),
        estimatedFeeNative: "0.00001",
        estimatedFeeFormatted: "< 0.001 SOL",
        nativeSymbol: "SOL",
      });
      return;
    }

    if (!activeWallet || !recipient || !amount) return;
    if (!isValidEvmAddress(recipient)) return;
    
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    setGasLoading(true);
    setGasError(null);

    try {
      let estimate: GasEstimate;
      
      if (params.isNative) {
        estimate = await estimateNativeGas(
          params.chainId,
          evmAddress as `0x${string}`,
          recipient as `0x${string}`,
          amount
        );
      } else {
        estimate = await estimateERC20Gas(
          params.chainId,
          evmAddress as `0x${string}`,
          params.tokenAddress as `0x${string}`,
          recipient as `0x${string}`,
          amount,
          params.decimals
        );
      }

      setGasEstimate(estimate);
    } catch (error) {
      console.error("Gas estimation failed:", error);
      setGasError("Could not estimate fee. Transaction may fail.");
    } finally {
      setGasLoading(false);
    }
  }, [activeWallet, recipient, amount, params, evmAddress]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      estimateGas();
    }, 500);
    return () => clearTimeout(timeout);
  }, [estimateGas]);

  const isValidAddress = (addr: string) => {
    if (params.chainType === "solana") {
      return isValidSolanaAddress(addr);
    }
    return isValidEvmAddress(addr);
  };

  const riskAssessment = (): RiskAssessment => {
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

    if (!isValidAddress(recipient)) {
      reasons.push(`Invalid ${params.chainType === "solana" ? "Solana" : "EVM"} address format`);
      level = "high";
      canProceed = false;
      return { level, reasons, canProceed };
    }

    const balance = parseFloat(params.balance.replace(/,/g, "") || "0");
    const sendAmount = parseFloat(amount);
    
    if (params.isNative) {
      const fee = parseFloat(gasEstimate?.estimatedFeeNative || "0");
      const totalRequired = sendAmount + fee;
      if (totalRequired > balance) {
        if (sendAmount > balance) {
          reasons.push("Insufficient balance");
        } else {
          reasons.push("Insufficient balance for amount + fee");
        }
        level = "blocked";
        canProceed = false;
      }
    } else {
      if (sendAmount > balance) {
        reasons.push("Insufficient token balance");
        level = "blocked";
        canProceed = false;
      }
    }

    if (sendAmount > 10000) {
      reasons.push("Large transaction - extra caution advised");
      if (level === "low") level = "medium";
    }

    return { level, reasons, canProceed };
  };

  const risk = riskAssessment();

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
    if (!activeWallet) return;

    setIsSending(true);

    try {
      let result: { hash: string; explorerUrl: string };

      if (params.chainType === "solana") {
        const mnemonic = await getMnemonic(activeWallet.id);
        if (!mnemonic) {
          throw new Error("Wallet is locked. Please unlock and try again.");
        }

        if (params.isNative) {
          const solResult = await sendSol(mnemonic, recipient, amount);
          result = { hash: solResult.signature, explorerUrl: solResult.explorerUrl };
        } else {
          const splResult = await sendSplToken({
            mnemonic,
            mintAddress: params.tokenAddress!,
            toAddress: recipient,
            amount,
            decimals: params.decimals,
          });
          result = { hash: splResult.signature, explorerUrl: splResult.explorerUrl };
        }

        await saveTransaction({
          chainId: 0,
          walletAddress: solanaAddress,
          hash: result.hash,
          type: params.isNative ? "native" : "spl",
          activityType: "send",
          tokenAddress: params.tokenAddress,
          tokenSymbol: params.tokenSymbol,
          to: recipient,
          amount,
          priceUsd: params.priceUsd,
          explorerUrl: result.explorerUrl,
        });
      } else {
        if (params.isNative) {
          result = await sendNative({
            chainId: params.chainId,
            walletId: activeWallet.id,
            to: recipient as `0x${string}`,
            amountNative: amount,
          });
        } else {
          result = await sendERC20({
            chainId: params.chainId,
            walletId: activeWallet.id,
            tokenAddress: params.tokenAddress as `0x${string}`,
            tokenDecimals: params.decimals,
            to: recipient as `0x${string}`,
            amount,
          });
        }

        await saveTransaction({
          chainId: params.chainId,
          walletAddress: evmAddress,
          hash: result.hash,
          type: params.isNative ? "native" : "erc20",
          activityType: "send",
          tokenAddress: params.tokenAddress,
          tokenSymbol: params.tokenSymbol,
          to: recipient,
          amount,
          priceUsd: params.priceUsd,
          explorerUrl: result.explorerUrl,
        });
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTxSuccess({ hash: result.hash, explorerUrl: result.explorerUrl });
    } catch (error) {
      console.error("Transaction failed:", error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      
      if (error instanceof TransactionFailedError && error.code === "WALLET_LOCKED") {
        Alert.alert(
          "Wallet Locked",
          "Please unlock your wallet and try again.",
          [
            { text: "OK", onPress: () => navigation.navigate("Unlock") },
          ]
        );
      } else {
        Alert.alert(
          "Transaction Failed",
          error instanceof Error ? error.message : "An unexpected error occurred"
        );
      }
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

    if (!risk.canProceed) {
      Alert.alert(
        "Transaction Blocked",
        `This transaction cannot proceed:\n\n${risk.reasons.join("\n")}`,
        [{ text: "OK" }]
      );
      return;
    }

    const warningText = risk.reasons.length > 0 
      ? `\n\nWarnings:\n${risk.reasons.map(r => `- ${r}`).join("\n")}`
      : "";

    const feeText = gasEstimate 
      ? `Fee: ~${gasEstimate.estimatedFeeFormatted}`
      : "Fee: Estimating...";

    const chainName = params.chainType === "solana" ? "Solana" : 
      params.chainId === 1 ? "Ethereum" : 
      params.chainId === 137 ? "Polygon" : "BNB Chain";

    Alert.alert(
      "Wallet Firewall - Before You Sign",
      `Transaction Summary:\n\nSending: ${amount} ${params.tokenSymbol}\nTo: ${recipient.slice(0, 10)}...${recipient.slice(-4)}\nNetwork: ${chainName}\n${feeText}\n\nRisk Level: ${getRiskLabel(risk.level)}${warningText}`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: risk.level === "high" ? "I Understand, Send" : "Confirm Send",
          style: risk.level === "high" ? "destructive" : "default",
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
              Transaction {params.chainType === "solana" ? "Signature" : "Hash"}
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
              onPress={() => navigation.popToTop()}
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
        <View style={[styles.tokenCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[styles.tokenIcon, { backgroundColor: theme.accent + "20" }]}>
            <ThemedText type="h2" style={{ color: theme.accent }}>
              {params.tokenSymbol.slice(0, 2)}
            </ThemedText>
          </View>
          <ThemedText type="h3">{params.tokenSymbol}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Balance: {params.balance}
          </ThemedText>
        </View>

        <View style={styles.form}>
          <Input
            label="Recipient Address"
            value={recipient}
            onChangeText={setRecipient}
            placeholder={params.chainType === "solana" ? "Solana address..." : "0x..."}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.amountSection}>
            <View style={styles.amountHeader}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Amount
              </ThemedText>
              <Pressable onPress={() => setAmount(params.balance.replace(/,/g, ""))}>
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

        {risk.reasons.length > 0 ? (
          <View style={[
            styles.riskCard, 
            { 
              backgroundColor: getRiskColor(risk.level) + "15",
              borderColor: getRiskColor(risk.level) + "40",
            }
          ]}>
            <View style={styles.riskHeader}>
              <Feather 
                name={risk.level === "low" ? "check-circle" : "alert-triangle"} 
                size={20} 
                color={getRiskColor(risk.level)} 
              />
              <ThemedText type="body" style={{ color: getRiskColor(risk.level), fontWeight: "600" }}>
                {getRiskLabel(risk.level)}
              </ThemedText>
            </View>
            {risk.reasons.map((reason, index) => (
              <ThemedText key={index} type="small" style={{ color: getRiskColor(risk.level) }}>
                - {reason}
              </ThemedText>
            ))}
          </View>
        ) : null}

        <View style={[styles.feeCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.feeRow}>
            <ThemedText type="body">
              Estimated {params.chainType === "solana" ? "Fee" : "Gas Fee"}
            </ThemedText>
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
            disabled={isSending || !risk.canProceed}
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
  tokenCard: {
    alignItems: "center",
    padding: Spacing.xl,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  tokenIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  form: {
    gap: Spacing.xl,
    marginBottom: Spacing.xl,
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
