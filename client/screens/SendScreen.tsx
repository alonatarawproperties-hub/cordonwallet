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
import { useWallet } from "@/lib/wallet-context";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import { NETWORKS, ChainType } from "@/lib/types";
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
  address?: string;
  decimals: number;
  isNative: boolean;
  priceUsd?: number;
  mint?: string;
}

const CHAIN_OPTIONS: { id: ChainType; name: string; color: string }[] = [
  { id: "evm", name: "EVM", color: "#627EEA" },
  { id: "solana", name: "Solana", color: "#9945FF" },
];

function isValidSolanaAddress(address: string): boolean {
  if (!address || address.length < 32 || address.length > 44) return false;
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  return base58Regex.test(address);
}

function isValidEvmAddress(address: string): boolean {
  return address.startsWith("0x") && address.length === 42;
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

  const isSolanaOnly = activeWallet?.walletType === "solana-only";
  const [selectedChainType, setSelectedChainType] = useState<ChainType>(
    isSolanaOnly ? "solana" : "evm"
  );

  const chainId = selectedChainType === "solana" ? 0 : NETWORKS[selectedNetwork].chainId;

  const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address || "";
  const solanaAddress = activeWallet?.addresses?.solana || "";

  const { assets: evmAssets } = usePortfolio(
    selectedChainType === "evm" && evmAddress ? evmAddress : undefined,
    selectedNetwork
  );
  const { assets: solanaAssets } = useSolanaPortfolio(
    selectedChainType === "solana" ? solanaAddress : undefined
  );

  const tokens: TokenOption[] = useMemo(() => {
    if (selectedChainType === "solana") {
      return solanaAssets.map((asset) => ({
        symbol: asset.symbol,
        balance: asset.balance,
        address: asset.mint,
        mint: asset.mint,
        decimals: asset.decimals,
        isNative: asset.isNative,
        priceUsd: asset.priceUsd,
      }));
    }
    return evmAssets.map((asset) => ({
      symbol: asset.symbol,
      balance: asset.balance,
      address: asset.isNative ? undefined : asset.address,
      decimals: asset.decimals,
      isNative: asset.isNative,
      priceUsd: asset.priceUsd,
    }));
  }, [selectedChainType, evmAssets, solanaAssets]);

  useEffect(() => {
    setSelectedToken("");
    setGasEstimate(null);
  }, [selectedChainType]);

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
    if (selectedChainType === "solana") {
      setGasEstimate({
        gasLimit: BigInt(5000),
        maxFeePerGas: BigInt(1),
        maxPriorityFeePerGas: BigInt(1),
        estimatedFeeNative: "0.000005",
        estimatedFeeFormatted: "~0.000005 SOL",
        nativeSymbol: "SOL",
      });
      return;
    }

    if (!activeWallet || !recipient || !amount || !selectedTokenData) return;
    if (!isValidEvmAddress(recipient)) return;
    
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    setGasLoading(true);
    setGasError(null);

    try {
      let estimate: GasEstimate;
      
      if (selectedTokenData.isNative) {
        estimate = await estimateNativeGas(
          chainId,
          evmAddress as `0x${string}`,
          recipient as `0x${string}`,
          amount
        );
      } else {
        estimate = await estimateERC20Gas(
          chainId,
          evmAddress as `0x${string}`,
          selectedTokenData.address as `0x${string}`,
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
  }, [activeWallet, recipient, amount, selectedTokenData, chainId, selectedChainType, evmAddress]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      estimateGas();
    }, 500);
    return () => clearTimeout(timeout);
  }, [estimateGas]);

  const isValidAddress = (addr: string) => {
    if (selectedChainType === "solana") {
      return isValidSolanaAddress(addr);
    }
    return isValidEvmAddress(addr);
  };

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

    if (!isValidAddress(recipient)) {
      reasons.push(`Invalid ${selectedChainType === "solana" ? "Solana" : "EVM"} address format`);
      level = "high";
      canProceed = false;
      return { level, reasons, canProceed };
    }

    const balance = parseFloat(selectedTokenData?.balance.replace(/,/g, "") || "0");
    const sendAmount = parseFloat(amount);
    
    if (selectedTokenData?.isNative) {
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
  }, [recipient, amount, policySettings, selectedTokenData, gasEstimate, selectedChainType]);

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
      let result: { hash: string; explorerUrl: string };

      if (selectedChainType === "solana") {
        const mnemonic = await getMnemonic(activeWallet.id);
        if (!mnemonic) {
          throw new Error("Wallet is locked. Please unlock and try again.");
        }

        if (selectedTokenData.isNative) {
          const solResult = await sendSol(mnemonic, recipient, amount);
          result = { hash: solResult.signature, explorerUrl: solResult.explorerUrl };
        } else {
          const splResult = await sendSplToken({
            mnemonic,
            mintAddress: selectedTokenData.mint!,
            toAddress: recipient,
            amount,
            decimals: selectedTokenData.decimals,
          });
          result = { hash: splResult.signature, explorerUrl: splResult.explorerUrl };
        }

        await saveTransaction({
          chainId: 0,
          walletAddress: solanaAddress || "",
          hash: result.hash,
          type: selectedTokenData.isNative ? "native" : "spl",
          activityType: "send",
          tokenAddress: selectedTokenData.mint,
          tokenSymbol: selectedTokenData.symbol,
          to: recipient,
          amount,
          priceUsd: selectedTokenData.priceUsd,
          explorerUrl: result.explorerUrl,
        });
      } else {
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
            tokenAddress: selectedTokenData.address as `0x${string}`,
            tokenDecimals: selectedTokenData.decimals,
            to: recipient as `0x${string}`,
            amount,
          });
        }

        await saveTransaction({
          chainId,
          walletAddress: evmAddress || activeWallet.address,
          hash: result.hash,
          type: selectedTokenData.isNative ? "native" : "erc20",
          activityType: "send",
          tokenAddress: selectedTokenData.address,
          tokenSymbol: selectedTokenData.symbol,
          to: recipient,
          amount,
          priceUsd: selectedTokenData.priceUsd,
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
      ? `Fee: ~${gasEstimate.estimatedFeeFormatted}`
      : "Fee: Estimating...";

    const networkName = selectedChainType === "solana" ? "Solana" : NETWORKS[selectedNetwork].name;

    Alert.alert(
      "Wallet Firewall - Before You Sign",
      `Transaction Summary:\n\nSending: ${amount} ${selectedToken}\nTo: ${recipient.slice(0, 10)}...${recipient.slice(-4)}\nNetwork: ${networkName}\n${feeText}\n\nRisk Level: ${getRiskLabel(riskAssessment.level)}${warningText}`,
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
              Transaction {selectedChainType === "solana" ? "Signature" : "Hash"}
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
        {!isSolanaOnly ? (
          <View style={[styles.chainSelectorCard, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Sending on
            </ThemedText>
            <View style={styles.chainSelector}>
              {CHAIN_OPTIONS.map((chain) => (
                <Pressable
                  key={chain.id}
                  style={[
                    styles.chainOption,
                    { 
                      backgroundColor: selectedChainType === chain.id ? chain.color + "20" : "transparent",
                      borderColor: selectedChainType === chain.id ? chain.color : theme.border,
                    },
                  ]}
                  onPress={() => setSelectedChainType(chain.id)}
                >
                  <View style={[styles.chainDot, { backgroundColor: chain.color }]} />
                  <ThemedText 
                    type="small" 
                    style={{ 
                      color: selectedChainType === chain.id ? chain.color : theme.textSecondary,
                      fontWeight: selectedChainType === chain.id ? "600" : "400",
                    }}
                  >
                    {chain.name}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <View style={[styles.networkCard, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Sending on
            </ThemedText>
            <View style={[styles.solanaBadge, { backgroundColor: "#9945FF20" }]}>
              <View style={[styles.chainDot, { backgroundColor: "#9945FF" }]} />
              <ThemedText type="small" style={{ color: "#9945FF", fontWeight: "600" }}>
                Solana
              </ThemedText>
            </View>
          </View>
        )}

        <View style={styles.form}>
          <Input
            label="Recipient Address"
            value={recipient}
            onChangeText={setRecipient}
            placeholder={selectedChainType === "solana" ? "Solana address..." : "0x..."}
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
              <Pressable onPress={() => setAmount(selectedTokenData?.balance.replace(/,/g, "") || "")}>
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
            <ThemedText type="body">
              Estimated {selectedChainType === "solana" ? "Fee" : "Gas Fee"}
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
  chainSelectorCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  chainSelector: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  chainOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  chainDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  solanaBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
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
