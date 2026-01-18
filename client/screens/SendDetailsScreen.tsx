import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { View, StyleSheet, Pressable, Alert, ActivityIndicator, TextInput, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "@react-navigation/native";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ScamExplainerModal } from "@/components/ScamExplainerModal";
import { AnimatedRiskCard } from "@/components/AnimatedRiskCard";
import { WalletFirewallModal, RestrictionBanner, buildRestrictionBanners } from "@/components/WalletFirewallModal";
import { ErrorModal, TransferBlockedModal } from "@/components/ErrorModal";
import { useWallet } from "@/lib/wallet-context";
import { TransferRestriction } from "@/lib/solana/token2022Guard";
import { Connection } from "@solana/web3.js";
import { getMintTransferRules, checkTransferability } from "@/lib/solana/token2022-transferability";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

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
import { saveTransaction, updateTransactionStatus } from "@/lib/transaction-history";
import { getApiUrl } from "@/lib/query-client";
import { checkAddressBlocklist } from "@/lib/security/blocklist";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "SendDetails">;

type RiskLevel = "low" | "medium" | "high" | "blocked" | "scam";

interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
  canProceed: boolean;
  isScam?: boolean;
  scamReason?: string;
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
  const [showScamModal, setShowScamModal] = useState(false);
  const [scamOverrideAccepted, setScamOverrideAccepted] = useState(false);
  const [showFirewallModal, setShowFirewallModal] = useState(false);
  const [tokenRestriction, setTokenRestriction] = useState<TransferRestriction | null>(null);
  const [restrictionBanners, setRestrictionBanners] = useState<RestrictionBanner[]>([]);
  const [isCheckingRestrictions, setIsCheckingRestrictions] = useState(false);
  
  const [errorModal, setErrorModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon?: "alert-circle" | "lock" | "x-octagon" | "alert-triangle";
  }>({ visible: false, title: "", message: "" });
  const [transferBlockedModal, setTransferBlockedModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
  }>({ visible: false, title: "", message: "" });

  const evmAddress = activeWallet?.addresses?.evm || activeWallet?.address || "";
  const solanaAddress = activeWallet?.addresses?.solana || "";
  
  useEffect(() => {
    if (params.scannedAddress) {
      setRecipient(params.scannedAddress);
    }
  }, [params.scannedAddress]);

  useEffect(() => {
    setScamOverrideAccepted(false);
  }, [recipient]);


  const estimateGas = useCallback(async () => {
    if (params.chainType === "solana") {
      setGasLoading(true);
      try {
        const apiUrl = getApiUrl();
        const url = new URL("/api/solana/estimate-fee", apiUrl);
        url.searchParams.set("isToken", params.isNative ? "false" : "true");
        
        const response = await fetch(url.toString());
        if (response.ok) {
          const data = await response.json();
          setGasEstimate({
            gasLimit: BigInt(data.lamports),
            maxFeePerGas: BigInt(1),
            maxPriorityFeePerGas: BigInt(1),
            estimatedFeeNative: data.sol,
            estimatedFeeFormatted: data.formatted,
            nativeSymbol: "SOL",
          });
        } else {
          setGasEstimate({
            gasLimit: BigInt(5000),
            maxFeePerGas: BigInt(1),
            maxPriorityFeePerGas: BigInt(1),
            estimatedFeeNative: "0.000005",
            estimatedFeeFormatted: "~5 microSOL",
            nativeSymbol: "SOL",
          });
        }
      } catch (error) {
        console.error("Solana fee estimation failed:", error);
        setGasEstimate({
          gasLimit: BigInt(5000),
          maxFeePerGas: BigInt(1),
          maxPriorityFeePerGas: BigInt(1),
          estimatedFeeNative: "0.000005",
          estimatedFeeFormatted: "~5 microSOL",
          nativeSymbol: "SOL",
        });
      } finally {
        setGasLoading(false);
      }
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

  const risk = useMemo((): RiskAssessment => {
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

    const blocklistCheck = checkAddressBlocklist(recipient);
    if (blocklistCheck.isBlocked) {
      const scamReason = blocklistCheck.reason || "Known malicious address detected";
      reasons.push(scamReason);
      return { 
        level: "scam", 
        reasons, 
        canProceed: scamOverrideAccepted,
        isScam: true,
        scamReason,
      };
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
  }, [recipient, amount, policySettings.denylistedAddresses, policySettings.allowlistedAddresses, scamOverrideAccepted, params.chainType, params.balance, params.isNative, gasEstimate?.estimatedFeeNative, isValidAddress]);


  const getRiskColor = (level: RiskLevel) => {
    switch (level) {
      case "low": return theme.success;
      case "medium": return theme.warning;
      case "high": return theme.danger;
      case "blocked": return theme.danger;
      case "scam": return theme.danger;
    }
  };

  const getRiskLabel = (level: RiskLevel) => {
    switch (level) {
      case "low": return "Low Risk";
      case "medium": return "Medium Risk";
      case "high": return "High Risk";
      case "blocked": return "Blocked";
      case "scam": return "Scam Detected";
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
          setIsSending(false);
          Alert.alert(
            "Session Expired",
            "For security, your wallet has been locked. Please unlock to continue.",
            [
              { text: "Cancel", style: "cancel" },
              { 
                text: "Unlock", 
                onPress: () => navigation.navigate("Unlock")
              }
            ]
          );
          return;
        }

        let txStatus: "confirmed" | "failed" = "confirmed";
        let txError: string | undefined;

        if (params.isNative) {
          const solResult = await sendSol(mnemonic, recipient, amount);
          result = { hash: solResult.signature, explorerUrl: solResult.explorerUrl };
          txStatus = solResult.status;
          txError = solResult.error;
        } else {
          const splResult = await sendSplToken({
            mnemonic,
            mintAddress: params.tokenAddress!,
            toAddress: recipient,
            amount,
            decimals: params.decimals,
          });
          result = { hash: splResult.signature, explorerUrl: splResult.explorerUrl };
          txStatus = splResult.status;
          txError = splResult.error;
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
          status: txStatus,
        });
        
        if (txStatus === "failed") {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert(
            "Transaction Failed",
            txError || "The transaction was submitted but failed on-chain. Check the explorer for details.",
            [{ text: "OK" }]
          );
          setIsSending(false);
          return;
        }
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
      
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
      const lowerMessage = errorMessage.toLowerCase();
      
      const isToken2022Error = 
        lowerMessage.includes("non-transferable") ||
        lowerMessage.includes("nontransferable") ||
        lowerMessage.includes("permanent delegate") ||
        lowerMessage.includes("owner does not match") ||
        lowerMessage.includes("transfer hook") ||
        lowerMessage.includes("token-2022") ||
        lowerMessage.includes("0x11") || 
        lowerMessage.includes("custom program error");
      
      if (error instanceof TransactionFailedError && error.code === "WALLET_LOCKED") {
        setErrorModal({
          visible: true,
          title: "Wallet Locked",
          message: "Please unlock your wallet and try again.",
          icon: "lock",
        });
      } else if (isToken2022Error) {
        setTransferBlockedModal({
          visible: true,
          title: "Token can't be transferred",
          message: "This token has transfer restrictions. It may be non-transferable or only movable by a specific delegate. You can still use it in supported apps.",
        });
      } else if (lowerMessage.includes("no record of a prior credit") && !lowerMessage.includes("custom program error")) {
        setErrorModal({
          visible: true,
          title: "Insufficient SOL for Fees",
          message: "You need SOL in your wallet to pay for transaction fees. When sending tokens to a new address, a small amount of SOL (~0.002) is also needed to create the recipient's token account.",
          icon: "alert-circle",
        });
      } else if (lowerMessage.includes("insufficient") && !isToken2022Error) {
        setErrorModal({
          visible: true,
          title: "Insufficient Balance",
          message: "You don't have enough balance to complete this transaction including gas fees.",
          icon: "alert-circle",
        });
      } else if (lowerMessage.includes("simulation failed") && params.chainType === "solana") {
        setErrorModal({
          visible: true,
          title: "Transaction Failed",
          message: "The transaction couldn't be completed. This may be due to token restrictions, network issues, or insufficient balance.",
          icon: "alert-triangle",
        });
      } else {
        setErrorModal({
          visible: true,
          title: "Transaction Failed",
          message: errorMessage.length > 200 ? errorMessage.slice(0, 200) + "..." : errorMessage,
          icon: "alert-circle",
        });
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleReview = async () => {
    if (!recipient.trim()) {
      setErrorModal({
        visible: true,
        title: "Missing Address",
        message: "Please enter a recipient address to continue.",
        icon: "alert-circle",
      });
      return;
    }
    if (!amount.trim() || parseFloat(amount) <= 0) {
      setErrorModal({
        visible: true,
        title: "Invalid Amount",
        message: "Please enter a valid amount to send.",
        icon: "alert-circle",
      });
      return;
    }
    
    if (params.chainType === "solana" && !params.isNative && params.tokenAddress) {
      setIsCheckingRestrictions(true);
      try {
        const connection = new Connection(SOLANA_RPC_URL, "confirmed");
        const rules = await getMintTransferRules(connection, params.tokenAddress);
        const transferCheck = checkTransferability(rules, solanaAddress);
        
        console.log(`[SendDetails] Preflight check for ${params.tokenSymbol}:`, {
          program: rules.program,
          isNonTransferable: rules.isNonTransferable,
          permanentDelegate: rules.permanentDelegate?.slice(0, 8),
          canTransfer: transferCheck.canTransfer,
          reason: transferCheck.reason,
        });
        
        if (!transferCheck.canTransfer) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setTransferBlockedModal({
            visible: true,
            title: transferCheck.title || "Token can't be transferred",
            message: transferCheck.message || "This token has transfer restrictions.",
          });
          setIsCheckingRestrictions(false);
          return;
        }
      } catch (error) {
        console.error("[SendDetails] Preflight check failed:", error);
      }
      setIsCheckingRestrictions(false);
    }

    if (risk.isScam && !scamOverrideAccepted) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setShowScamModal(true);
      return;
    }

    if (!risk.canProceed) {
      setTokenRestriction(null);
      setRestrictionBanners([{
        type: "danger",
        title: "Transaction Blocked",
        message: risk.reasons.join("\n"),
        icon: "x-octagon",
      }]);
      setShowFirewallModal(true);
      return;
    }

    let banners: RestrictionBanner[] = [];
    let restriction: TransferRestriction | null = null;

    if (params.chainType === "solana" && !params.isNative && params.tokenAddress) {
      setIsCheckingRestrictions(true);
      try {
        const { analyzeSolanaTransfer, buildWarningBanners } = await import("@/lib/solana/transfer-analyzer");
        const connection = new Connection(SOLANA_RPC_URL, "confirmed");
        
        const analysis = await analyzeSolanaTransfer({
          connection,
          mintAddress: params.tokenAddress,
          fromAddress: solanaAddress,
          toAddress: recipient,
          amount,
        });

        const analyzerBanners = buildWarningBanners(analysis);
        banners = analyzerBanners.map(b => ({
          type: b.type,
          title: b.title,
          message: b.message,
          icon: b.icon as keyof typeof Feather.glyphMap,
        }));

        if (analysis.tokenStandard === "token-2022") {
          restriction = {
            canTransfer: analysis.canTransfer,
            restrictionType: analysis.flags.isNonTransferable 
              ? (analysis.isUserDelegate ? "delegate_only" : "non_transferable")
              : analysis.flags.hasTransferHook
                ? "transfer_hook"
                : "none",
            message: analysis.warnings.length > 0 ? analysis.warnings[0].message : "",
            delegateAddress: analysis.permanentDelegate,
            isUserDelegate: analysis.isUserDelegate,
          };
        }

        if (!analysis.canTransfer) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setTokenRestriction(restriction);
          setRestrictionBanners(banners);
          setShowFirewallModal(true);
          setIsCheckingRestrictions(false);
          return;
        }
      } catch (error) {
        console.error("[SendDetails] Token analysis failed:", error);
        banners.push({
          type: "warning",
          title: "Analysis Unavailable",
          message: "Couldn't analyze token restrictions. Proceed with caution.",
          icon: "alert-circle",
        });
      }
      setIsCheckingRestrictions(false);
    }

    if (risk.reasons.length > 0) {
      for (const reason of risk.reasons) {
        banners.push({
          type: risk.level === "high" ? "warning" : "info",
          title: "Risk Warning",
          message: reason,
          icon: "alert-triangle",
        });
      }
    }

    setTokenRestriction(restriction);
    setRestrictionBanners(banners);
    setShowFirewallModal(true);
  };

  const handleFirewallConfirm = () => {
    setShowFirewallModal(false);
    handleSend();
  };

  const handleFirewallClose = () => {
    setShowFirewallModal(false);
  };

  const getNetworkName = () => {
    if (params.chainType === "solana") return "Solana";
    switch (params.chainId) {
      case 1: return "Ethereum";
      case 137: return "Polygon";
      case 56: return "BNB Chain";
      default: return "EVM";
    }
  };

  const handleScamModalClose = () => {
    setShowScamModal(false);
  };

  const handleProceedAnyway = () => {
    setShowScamModal(false);
    setScamOverrideAccepted(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
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
            {params.logoUrl ? (
              <Image source={{ uri: params.logoUrl }} style={styles.tokenLogo} />
            ) : (
              <ThemedText type="h2" style={{ color: theme.accent }}>
                {params.tokenSymbol.slice(0, 2)}
              </ThemedText>
            )}
          </View>
          <ThemedText type="h3">{params.tokenSymbol}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Balance: {params.balance}
          </ThemedText>
        </View>

        <View style={styles.form}>
          <View style={styles.addressSection}>
            <View style={styles.addressLabelRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Recipient Address
              </ThemedText>
              <View style={styles.addressActions}>
                <Pressable 
                  style={styles.addressActionButton}
                  onPress={async () => {
                    const text = await Clipboard.getStringAsync();
                    if (text) {
                      setRecipient(text.trim());
                      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                  }}
                >
                  <ThemedText type="small" style={{ color: theme.accent }}>
                    Paste
                  </ThemedText>
                </Pressable>
                <Pressable 
                  style={[styles.addressIconButton, { backgroundColor: theme.accent + "20" }]}
                  onPress={() => navigation.navigate("ScanQR")}
                >
                  <Feather name="maximize" size={18} color={theme.accent} />
                </Pressable>
              </View>
            </View>
            <View style={[styles.addressInputContainer, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
              <TextInput
                style={[styles.addressInput, { color: theme.text }]}
                value={recipient}
                onChangeText={setRecipient}
                placeholder={params.chainType === "solana" ? "Solana address..." : "0x..."}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

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
          <AnimatedRiskCard
            level={risk.level}
            label={getRiskLabel(risk.level)}
            reasons={risk.reasons}
            animate={risk.isScam === true && !scamOverrideAccepted}
          />
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
            disabled={isSending || isCheckingRestrictions || (!risk.canProceed && !risk.isScam)}
            style={risk.isScam && !scamOverrideAccepted ? { backgroundColor: theme.danger } : undefined}
          >
            {isSending 
              ? "Sending..." 
              : isCheckingRestrictions 
                ? "Analyzing..." 
                : risk.isScam && !scamOverrideAccepted 
                  ? "Review Warning" 
                  : "Review Transaction"}
          </Button>
        </View>
      </KeyboardAwareScrollViewCompat>

      <ScamExplainerModal
        visible={showScamModal}
        address={recipient}
        reason={risk.scamReason || "Known malicious address detected"}
        onClose={handleScamModalClose}
        onProceedAnyway={handleProceedAnyway}
      />

      <WalletFirewallModal
        visible={showFirewallModal}
        onClose={handleFirewallClose}
        onConfirm={handleFirewallConfirm}
        amount={amount}
        tokenSymbol={params.tokenSymbol}
        recipient={recipient}
        network={getNetworkName()}
        fee={gasEstimate?.estimatedFeeFormatted || "Estimating..."}
        riskLevel={risk.level}
        riskReasons={risk.reasons}
        restrictions={restrictionBanners}
        isBlocked={!risk.canProceed || (tokenRestriction !== null && !tokenRestriction.canTransfer)}
        isLoading={isSending}
      />

      <ErrorModal
        visible={errorModal.visible}
        title={errorModal.title}
        message={errorModal.message}
        icon={errorModal.icon}
        onClose={() => setErrorModal({ visible: false, title: "", message: "" })}
      />

      <TransferBlockedModal
        visible={transferBlockedModal.visible}
        title={transferBlockedModal.title}
        message={transferBlockedModal.message}
        onClose={() => setTransferBlockedModal({ visible: false, title: "", message: "" })}
      />

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
    overflow: "hidden",
  },
  tokenLogo: {
    width: 60,
    height: 60,
    borderRadius: 30,
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
  addressSection: {
    gap: Spacing.sm,
  },
  addressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  addressActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  addressActionButton: {
    paddingVertical: Spacing.xs,
  },
  addressIconButton: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  addressInputContainer: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  addressInput: {
    fontSize: 16,
  },
});
