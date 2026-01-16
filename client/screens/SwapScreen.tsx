import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { VersionedTransaction, Keypair } from "@solana/web3.js";
import bs58 from "bs58";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useWallet } from "@/lib/wallet-context";
import { getMnemonic } from "@/lib/wallet-engine";
import { deriveSolanaKeypair } from "@/lib/solana/keys";
import { useSolanaPortfolio, SolanaAsset } from "@/hooks/useSolanaPortfolio";
import {
  SwapSpeed,
  SPEED_CONFIGS,
  DEFAULT_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  QUOTE_REFRESH_INTERVAL_MS,
  QUOTE_DEBOUNCE_MS,
  SOL_MINT,
  USDC_MINT,
  LAMPORTS_PER_SOL,
  ADV_MAX_CAP_SOL,
} from "@/constants/solanaSwap";
import {
  TokenInfo,
  searchTokens,
  getPopularTokens,
  formatTokenAmount,
  parseTokenAmount,
  formatBaseUnits,
  getTokenByMint,
} from "@/services/solanaTokenList";
import {
  getQuote,
  buildSwapTransaction,
  calculatePriceImpact,
  formatRoute,
  estimateNetworkFee,
  QuoteResponse,
  SwapResponse,
} from "@/services/jupiter";
import { calculateFeeConfig, formatFeeDisplay } from "@/lib/solana/feeController";
import { decodeAndValidateSwapTx, isDrainerTransaction } from "@/lib/solana/swapSecurity";
import { broadcastTransaction, classifyError, getExplorerUrl } from "@/services/txBroadcaster";
import { addSwapRecord, updateSwapStatus, addDebugLog, SwapTimings } from "@/services/swapStore";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export default function SwapScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { activeWallet } = useWallet();
  
  const solanaAddress = activeWallet?.addresses?.solana;
  const { assets: solanaAssets, refresh: refreshPortfolio } = useSolanaPortfolio(solanaAddress);

  const [inputToken, setInputToken] = useState<TokenInfo | null>(null);
  const [outputToken, setOutputToken] = useState<TokenInfo | null>(null);
  const [inputAmount, setInputAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [speed, setSpeed] = useState<SwapSpeed>("standard");
  const [customCapSol, setCustomCapSol] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [isSwapping, setIsSwapping] = useState(false);
  const [swapStatus, setSwapStatus] = useState<string>("");

  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenModalType, setTokenModalType] = useState<"input" | "output">("input");
  const [tokenSearch, setTokenSearch] = useState("");
  const [tokenResults, setTokenResults] = useState<TokenInfo[]>([]);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingSwap, setPendingSwap] = useState<{
    quote: QuoteResponse;
    swapResponse: SwapResponse;
  } | null>(null);

  const quoteTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const quoteIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const getTokenBalance = useCallback((mint: string): number => {
    if (!solanaAssets || solanaAssets.length === 0) return 0;
    
    if (mint === SOL_MINT) {
      const solAsset = solanaAssets.find(a => a.isNative);
      if (solAsset) {
        return parseFloat(solAsset.balance.replace(/,/g, ""));
      }
    } else {
      const tokenAsset = solanaAssets.find(a => a.mint?.toLowerCase() === mint.toLowerCase());
      if (tokenAsset) {
        return parseFloat(tokenAsset.balance.replace(/,/g, ""));
      }
    }
    return 0;
  }, [solanaAssets]);

  const inputTokenBalance = inputToken ? getTokenBalance(inputToken.mint) : 0;

  useEffect(() => {
    const initTokens = async () => {
      const sol = await getTokenByMint(SOL_MINT);
      const usdc = await getTokenByMint(USDC_MINT);
      if (sol) setInputToken(sol);
      if (usdc) setOutputToken(usdc);
    };
    initTokens();
  }, []);

  useFocusEffect(
    useCallback(() => {
      return () => {
        if (quoteIntervalRef.current) {
          clearInterval(quoteIntervalRef.current);
        }
        if (quoteTimeoutRef.current) {
          clearTimeout(quoteTimeoutRef.current);
        }
      };
    }, [])
  );

  const fetchQuote = useCallback(async () => {
    if (!inputToken || !outputToken || !inputAmount || parseFloat(inputAmount) <= 0) {
      setQuote(null);
      return;
    }

    setIsQuoting(true);
    setQuoteError(null);

    try {
      const amountBaseUnits = parseTokenAmount(inputAmount, inputToken.decimals).toString();
      const result = await getQuote({
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amount: amountBaseUnits,
        slippageBps,
      });
      setQuote(result);
      await addDebugLog("info", "Quote fetched", { route: formatRoute(result) });
    } catch (error: any) {
      setQuoteError(error.message || "Failed to get quote");
      setQuote(null);
      await addDebugLog("error", "Quote failed", { error: error.message });
    } finally {
      setIsQuoting(false);
    }
  }, [inputToken, outputToken, inputAmount, slippageBps]);

  useEffect(() => {
    if (quoteTimeoutRef.current) {
      clearTimeout(quoteTimeoutRef.current);
    }

    if (inputAmount && parseFloat(inputAmount) > 0) {
      quoteTimeoutRef.current = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS);
    } else {
      setQuote(null);
    }

    return () => {
      if (quoteTimeoutRef.current) {
        clearTimeout(quoteTimeoutRef.current);
      }
    };
  }, [inputAmount, inputToken, outputToken, slippageBps]);

  useFocusEffect(
    useCallback(() => {
      if (quote && inputAmount && parseFloat(inputAmount) > 0) {
        quoteIntervalRef.current = setInterval(fetchQuote, QUOTE_REFRESH_INTERVAL_MS);
      }

      return () => {
        if (quoteIntervalRef.current) {
          clearInterval(quoteIntervalRef.current);
        }
      };
    }, [fetchQuote, quote, inputAmount])
  );

  const handleTokenSearch = async (query: string) => {
    setTokenSearch(query);
    if (query.trim()) {
      const results = await searchTokens(query);
      setTokenResults(results);
    } else {
      setTokenResults(getPopularTokens());
    }
  };

  const openTokenModal = (type: "input" | "output") => {
    Keyboard.dismiss();
    setTokenModalType(type);
    setTokenSearch("");
    setTokenResults(getPopularTokens());
    setShowTokenModal(true);
  };

  const selectToken = (token: TokenInfo) => {
    if (tokenModalType === "input") {
      if (outputToken?.mint === token.mint) {
        setOutputToken(inputToken);
      }
      setInputToken(token);
    } else {
      if (inputToken?.mint === token.mint) {
        setInputToken(outputToken);
      }
      setOutputToken(token);
    }
    setShowTokenModal(false);
    setQuote(null);
  };

  const swapTokens = () => {
    const temp = inputToken;
    setInputToken(outputToken);
    setOutputToken(temp);
    setInputAmount("");
    setQuote(null);
  };

  const handleMaxPress = async () => {
    if (!inputToken || !activeWallet) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const balance = getTokenBalance(inputToken.mint);
    if (inputToken.mint === SOL_MINT) {
      const reserveForFees = 0.01;
      const maxAmount = Math.max(0, balance - reserveForFees);
      setInputAmount(maxAmount.toFixed(6));
    } else {
      setInputAmount(balance.toFixed(inputToken.decimals > 6 ? 6 : inputToken.decimals));
    }
  };

  const handleSwapPress = async () => {
    if (!quote || !inputToken || !outputToken || !activeWallet) return;

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const solanaAddr = activeWallet.addresses?.solana;
    if (!solanaAddr) {
      Alert.alert("Error", "No Solana address found");
      return;
    }

    setIsSwapping(true);
    setSwapStatus("Building transaction...");

    const timings: SwapTimings = {};
    const buildStart = Date.now();

    try {
      const capSol = customCapSol ?? SPEED_CONFIGS[speed].capSol;
      const swapResponse = await buildSwapTransaction(quote, solanaAddr, speed, capSol);
      timings.buildLatencyMs = Date.now() - buildStart;

      const securityResult = decodeAndValidateSwapTx(
        swapResponse.swapTransaction,
        solanaAddr,
        outputToken.mint
      );

      if (!securityResult.safe) {
        await addDebugLog("error", "Security check failed", securityResult);
        Alert.alert("Blocked", securityResult.errors.join("\n"));
        setIsSwapping(false);
        setSwapStatus("");
        return;
      }

      if (isDrainerTransaction(swapResponse.swapTransaction)) {
        await addDebugLog("error", "Drainer detected");
        Alert.alert("Blocked", "This transaction contains suspicious instructions.");
        setIsSwapping(false);
        setSwapStatus("");
        return;
      }

      if (securityResult.warnings.length > 0) {
        await addDebugLog("warn", "Security warnings", securityResult.warnings);
      }

      setPendingSwap({ quote, swapResponse });
      setShowConfirmModal(true);
      setIsSwapping(false);
      setSwapStatus("");
    } catch (error: any) {
      await addDebugLog("error", "Build failed", { error: error.message });
      Alert.alert("Error", error.message || "Failed to build swap");
      setIsSwapping(false);
      setSwapStatus("");
    }
  };

  const confirmAndExecuteSwap = async () => {
    if (!pendingSwap || !activeWallet || !inputToken || !outputToken) return;

    setShowConfirmModal(false);
    setIsSwapping(true);
    setSwapStatus("Signing...");

    const timings: SwapTimings = {};
    const tapStart = Date.now();

    try {
      const solanaAddr = activeWallet.addresses?.solana;
      if (!solanaAddr) throw new Error("No Solana address");

      const mnemonic = await getMnemonic(activeWallet.id);
      if (!mnemonic) {
        Alert.alert("Error", "Please unlock your wallet first");
        setIsSwapping(false);
        return;
      }

      const { secretKey } = deriveSolanaKeypair(mnemonic);
      const keypair = Keypair.fromSecretKey(secretKey);
      
      const txBuffer = Buffer.from(pendingSwap.swapResponse.swapTransaction, "base64");
      const transaction = VersionedTransaction.deserialize(txBuffer);

      transaction.sign([keypair]);

      const signedBytes = transaction.serialize();
      timings.tapToSubmittedMs = Date.now() - tapStart;

      setSwapStatus("Submitting...");

      const outAmount = formatBaseUnits(
        pendingSwap.quote.outAmount,
        outputToken.decimals
      );
      const minReceived = formatBaseUnits(
        pendingSwap.quote.otherAmountThreshold,
        outputToken.decimals
      );

      const capSol = customCapSol ?? SPEED_CONFIGS[speed].capSol;

      const record = await addSwapRecord({
        timestamp: Date.now(),
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        inputSymbol: inputToken.symbol,
        outputSymbol: outputToken.symbol,
        inputAmount,
        outputAmount: outAmount,
        minReceived,
        slippageBps,
        mode: speed,
        capSol,
        signature: "",
        status: "submitted",
        timings,
        route: formatRoute(pendingSwap.quote),
        priceImpactPct: parseFloat(pendingSwap.quote.priceImpactPct),
      });

      const submitStart = Date.now();

      const result = await broadcastTransaction(signedBytes, {
        mode: speed,
        onStatusChange: (status, sig) => {
          if (sig && record.signature !== sig) {
            updateSwapStatus(record.id, status, { signature: sig });
          }
          if (status === "processed") {
            setSwapStatus("Processing...");
            timings.submittedToProcessedMs = Date.now() - submitStart;
          } else if (status === "confirmed" || status === "finalized") {
            setSwapStatus("Confirmed!");
            timings.processedToConfirmedMs = Date.now() - submitStart - (timings.submittedToProcessedMs || 0);
            timings.totalMs = Date.now() - tapStart;
          }
        },
        onRebroadcast: (count) => {
          setSwapStatus(`Rebroadcasting (${count})...`);
        },
      });

      await updateSwapStatus(record.id, result.status, {
        signature: result.signature,
        failureReason: result.error,
        failureCategory: result.error ? classifyError(result.error).category : undefined,
        timings: { ...timings, totalMs: Date.now() - tapStart },
      });

      await Haptics.notificationAsync(
        result.status === "confirmed" || result.status === "finalized"
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error
      );

      if (result.status === "confirmed" || result.status === "finalized") {
        Alert.alert(
          "Swap Successful",
          `Swapped ${inputAmount} ${inputToken.symbol} for ${outAmount} ${outputToken.symbol}`,
          [
            { text: "View", onPress: () => {
              const url = getExplorerUrl(result.signature);
              import("expo-web-browser").then(m => m.openBrowserAsync(url));
            }},
            { text: "OK" },
          ]
        );
        setInputAmount("");
        setQuote(null);
        refreshPortfolio();
      } else if (result.status === "expired") {
        Alert.alert(
          "Transaction Expired",
          "The transaction may still land. Check the explorer.",
          [
            { text: "View", onPress: () => {
              const url = getExplorerUrl(result.signature);
              import("expo-web-browser").then(m => m.openBrowserAsync(url));
            }},
            { text: "Retry", onPress: handleSwapPress },
          ]
        );
      } else {
        const classified = classifyError(result.error || "");
        Alert.alert("Swap Failed", classified.userMessage, [
          ...(classified.canRetry ? [{ text: "Retry", onPress: handleSwapPress }] : []),
          { text: "OK" },
        ]);
      }
    } catch (error: any) {
      await addDebugLog("error", "Swap execution failed", { error: error.message });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", error.message || "Swap failed");
    } finally {
      setIsSwapping(false);
      setSwapStatus("");
      setPendingSwap(null);
    }
  };

  const feeConfig = calculateFeeConfig(speed, customCapSol ?? undefined);
  const priceImpact = quote ? calculatePriceImpact(quote) : null;

  const renderConfirmModal = () => {
    if (!pendingSwap || !inputToken || !outputToken) return null;

    const outAmount = formatBaseUnits(pendingSwap.quote.outAmount, outputToken.decimals);
    const minReceived = formatBaseUnits(pendingSwap.quote.otherAmountThreshold, outputToken.decimals);
    const networkFee = estimateNetworkFee(pendingSwap.swapResponse);

    return (
      <Modal visible={showConfirmModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.confirmModal, { backgroundColor: theme.backgroundDefault, paddingBottom: insets.bottom + Spacing.lg }]}>
            <ThemedText type="h2" style={styles.confirmTitle}>
              Confirm Swap
            </ThemedText>

            <View style={[styles.confirmRow, { borderBottomColor: theme.border }]}>
              <ThemedText type="body" style={{ color: theme.textSecondary }}>You pay</ThemedText>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {inputAmount} {inputToken.symbol}
              </ThemedText>
            </View>

            <View style={[styles.confirmRow, { borderBottomColor: theme.border }]}>
              <ThemedText type="body" style={{ color: theme.textSecondary }}>You receive</ThemedText>
              <ThemedText type="body" style={{ fontWeight: "600", color: "#22C55E" }}>
                ~{parseFloat(outAmount).toFixed(6)} {outputToken.symbol}
              </ThemedText>
            </View>

            <View style={[styles.confirmRow, { borderBottomColor: theme.border }]}>
              <ThemedText type="body" style={{ color: theme.textSecondary }}>Min received</ThemedText>
              <ThemedText type="body">
                {parseFloat(minReceived).toFixed(6)} {outputToken.symbol}
              </ThemedText>
            </View>

            <View style={[styles.confirmRow, { borderBottomColor: theme.border }]}>
              <ThemedText type="body" style={{ color: theme.textSecondary }}>Slippage</ThemedText>
              <ThemedText type="body">{(slippageBps / 100).toFixed(1)}%</ThemedText>
            </View>

            <View style={[styles.confirmRow, { borderBottomColor: theme.border }]}>
              <ThemedText type="body" style={{ color: theme.textSecondary }}>Network fee</ThemedText>
              <ThemedText type="body">{formatFeeDisplay(networkFee.feeSol)}</ThemedText>
            </View>

            <View style={[styles.confirmRow, { borderBottomColor: theme.border }]}>
              <ThemedText type="body" style={{ color: theme.textSecondary }}>Max priority fee</ThemedText>
              <ThemedText type="body">{formatFeeDisplay(feeConfig.maxCapSol)}</ThemedText>
            </View>

            <View style={[styles.confirmRow, { borderBottomColor: theme.border }]}>
              <ThemedText type="body" style={{ color: theme.textSecondary }}>Speed</ThemedText>
              <View style={[styles.speedBadge, { backgroundColor: theme.accent + "20" }]}>
                <ThemedText type="caption" style={{ color: theme.accent }}>
                  {SPEED_CONFIGS[speed].label}
                </ThemedText>
              </View>
            </View>

            {speed === "turbo" && (
              <View style={[styles.turboNote, { backgroundColor: theme.accent + "10" }]}>
                <Feather name="zap" size={14} color={theme.accent} />
                <ThemedText type="caption" style={{ color: theme.textSecondary, flex: 1, marginLeft: Spacing.xs }}>
                  Turbo increases priority fees + broadcast intensity to improve landing during congestion. Fees paid by you.
                </ThemedText>
              </View>
            )}

            <View style={styles.confirmButtons}>
              <Pressable
                style={[styles.cancelButton, { borderColor: theme.border }]}
                onPress={() => setShowConfirmModal(false)}
              >
                <ThemedText type="body">Cancel</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.confirmButton, { backgroundColor: theme.accent }]}
                onPress={confirmAndExecuteSwap}
              >
                <ThemedText type="body" style={{ color: "#fff", fontWeight: "600" }}>
                  Confirm Swap
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const renderTokenModal = () => (
    <Modal visible={showTokenModal} transparent animationType="slide" onRequestClose={() => setShowTokenModal(false)}>
      <KeyboardAvoidingView 
        style={styles.modalOverlay} 
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowTokenModal(false)} />
        <View style={[styles.tokenModal, { backgroundColor: theme.backgroundDefault, paddingBottom: insets.bottom + Spacing.md }]}>
          <View style={styles.tokenModalHeader}>
            <ThemedText type="h3">Select Token</ThemedText>
            <Pressable 
              onPress={() => setShowTokenModal(false)} 
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.closeButton}
            >
              <Feather name="x" size={24} color={theme.text} />
            </Pressable>
          </View>

          <View style={[styles.searchContainer, { backgroundColor: theme.backgroundSecondary }]}>
            <Feather name="search" size={18} color={theme.textSecondary} style={styles.searchIcon} />
            <TextInput
              style={[styles.tokenSearchInput, { color: theme.text }]}
              placeholder="Search by name or paste address"
              placeholderTextColor={theme.textSecondary}
              value={tokenSearch}
              onChangeText={handleTokenSearch}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <FlatList
            data={tokenResults}
            keyExtractor={(item) => item.mint}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.tokenItem, 
                  { backgroundColor: pressed ? theme.backgroundSecondary : "transparent" }
                ]}
                onPress={() => selectToken(item)}
              >
                {item.logoURI ? (
                  <Image source={{ uri: item.logoURI }} style={styles.tokenLogo} />
                ) : (
                  <View style={[styles.tokenLogoPlaceholder, { backgroundColor: theme.accent + "20" }]}>
                    <ThemedText type="caption" style={{ color: theme.accent, fontWeight: "600" }}>
                      {item.symbol.slice(0, 2)}
                    </ThemedText>
                  </View>
                )}
                <View style={styles.tokenInfo}>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>{item.symbol}</ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>{item.name}</ThemedText>
                </View>
              </Pressable>
            )}
            style={styles.tokenList}
            contentContainerStyle={styles.tokenListContent}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.swapCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.tokenSection}>
            <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              You pay
            </ThemedText>
            <Pressable
              style={({ pressed }) => [
                styles.tokenSelector, 
                { backgroundColor: pressed ? theme.backgroundSecondary + "80" : theme.backgroundSecondary }
              ]}
              onPress={() => openTokenModal("input")}
            >
              {inputToken?.logoURI ? (
                <Image source={{ uri: inputToken.logoURI }} style={styles.selectorLogo} />
              ) : (
                <View style={[styles.selectorLogoPlaceholder, { backgroundColor: theme.accent + "20" }]}>
                  <ThemedText type="caption" style={{ color: theme.accent, fontWeight: "600" }}>
                    {inputToken?.symbol.slice(0, 2) || "?"}
                  </ThemedText>
                </View>
              )}
              <ThemedText type="body" style={{ fontWeight: "600", flex: 1 }}>
                {inputToken?.symbol || "Select token"}
              </ThemedText>
              <Feather name="chevron-down" size={20} color={theme.textSecondary} />
            </Pressable>
            <View style={styles.amountRow}>
              <TextInput
                style={[styles.amountInput, { color: theme.text }]}
                placeholder="0.0"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                value={inputAmount}
                onChangeText={setInputAmount}
              />
              <Pressable 
                style={({ pressed }) => [
                  styles.maxButton, 
                  { backgroundColor: pressed ? theme.accent + "40" : theme.accent + "20" }
                ]} 
                onPress={handleMaxPress}
              >
                <ThemedText type="caption" style={{ color: theme.accent, fontWeight: "700" }}>MAX</ThemedText>
              </Pressable>
            </View>
            {inputToken && (
              <View style={styles.balanceRow}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  Balance: {inputTokenBalance.toFixed(inputToken.decimals > 6 ? 6 : 4)} {inputToken.symbol}
                </ThemedText>
              </View>
            )}
          </View>

          <Pressable style={styles.swapDirectionButton} onPress={swapTokens}>
            <View style={[styles.swapDirectionIcon, { backgroundColor: theme.backgroundRoot, borderColor: theme.border }]}>
              <Feather name="arrow-down" size={18} color={theme.accent} />
            </View>
          </Pressable>

          <View style={styles.tokenSection}>
            <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              You receive
            </ThemedText>
            <Pressable
              style={({ pressed }) => [
                styles.tokenSelector, 
                { backgroundColor: pressed ? theme.backgroundSecondary + "80" : theme.backgroundSecondary }
              ]}
              onPress={() => openTokenModal("output")}
            >
              {outputToken?.logoURI ? (
                <Image source={{ uri: outputToken.logoURI }} style={styles.selectorLogo} />
              ) : (
                <View style={[styles.selectorLogoPlaceholder, { backgroundColor: theme.accent + "20" }]}>
                  <ThemedText type="caption" style={{ color: theme.accent, fontWeight: "600" }}>
                    {outputToken?.symbol.slice(0, 2) || "?"}
                  </ThemedText>
                </View>
              )}
              <ThemedText type="body" style={{ fontWeight: "600", flex: 1 }}>
                {outputToken?.symbol || "Select token"}
              </ThemedText>
              <Feather name="chevron-down" size={20} color={theme.textSecondary} />
            </Pressable>
            <View style={styles.outputRow}>
              {isQuoting ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : quote ? (
                <ThemedText type="h3" style={{ color: "#22C55E" }}>
                  {formatTokenAmount(formatBaseUnits(quote.outAmount, outputToken?.decimals || 6), outputToken?.decimals || 6)}
                </ThemedText>
              ) : (
                <ThemedText type="h3" style={{ color: theme.textSecondary }}>0.0</ThemedText>
              )}
            </View>
          </View>
        </View>

        {quote && (
          <View style={[styles.quoteCard, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.quoteRow}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Rate</ThemedText>
              <ThemedText type="caption" style={{ fontWeight: "500" }}>
                1 {inputToken?.symbol} = {(parseFloat(formatBaseUnits(quote.outAmount, outputToken?.decimals || 6)) / parseFloat(inputAmount || "1")).toFixed(4)} {outputToken?.symbol}
              </ThemedText>
            </View>
            <View style={styles.quoteRow}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Price Impact</ThemedText>
              <ThemedText
                type="caption"
                style={{
                  fontWeight: "500",
                  color: priceImpact?.severity === "critical" ? "#EF4444" :
                         priceImpact?.severity === "high" ? "#F59E0B" :
                         priceImpact?.severity === "medium" ? "#EAB308" : theme.text
                }}
              >
                {priceImpact?.impactPct.toFixed(2)}%
              </ThemedText>
            </View>
            <View style={styles.quoteRow}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Route</ThemedText>
              <ThemedText type="caption" style={{ fontWeight: "500" }}>{formatRoute(quote)}</ThemedText>
            </View>
            <View style={styles.quoteRow}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Min received</ThemedText>
              <ThemedText type="caption" style={{ fontWeight: "500" }}>
                {formatTokenAmount(formatBaseUnits(quote.otherAmountThreshold, outputToken?.decimals || 6), outputToken?.decimals || 6)} {outputToken?.symbol}
              </ThemedText>
            </View>
          </View>
        )}

        {quoteError && (
          <View style={[styles.errorCard, { backgroundColor: "#EF444415" }]}>
            <Feather name="alert-circle" size={16} color="#EF4444" />
            <ThemedText type="caption" style={{ color: "#EF4444", marginLeft: Spacing.sm, flex: 1 }}>
              {quoteError}
            </ThemedText>
          </View>
        )}

        <View style={styles.settingsSection}>
          <View style={styles.settingsRow}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>Slippage</ThemedText>
            <View style={styles.slippageButtons}>
              {[50, 100, 300].map((bps) => (
                <Pressable
                  key={bps}
                  style={({ pressed }) => [
                    styles.slippageButton,
                    { 
                      backgroundColor: slippageBps === bps ? theme.accent : theme.backgroundSecondary,
                      opacity: pressed ? 0.8 : 1
                    },
                  ]}
                  onPress={() => setSlippageBps(bps)}
                >
                  <ThemedText
                    type="caption"
                    style={{ color: slippageBps === bps ? "#fff" : theme.text, fontWeight: "600" }}
                  >
                    {bps / 100}%
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.speedSection}>
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
              Speed
            </ThemedText>
            <View style={styles.speedButtons}>
              {(["standard", "fast", "turbo"] as SwapSpeed[]).map((s) => (
                <Pressable
                  key={s}
                  style={({ pressed }) => [
                    styles.speedButton,
                    {
                      backgroundColor: speed === s ? theme.accent : theme.backgroundSecondary,
                      borderColor: speed === s ? theme.accent : theme.border,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                  onPress={() => {
                    setSpeed(s);
                    setCustomCapSol(null);
                  }}
                >
                  <ThemedText
                    type="caption"
                    style={{ color: speed === s ? "#fff" : theme.text, fontWeight: "600" }}
                  >
                    {SPEED_CONFIGS[s].label}
                  </ThemedText>
                  <ThemedText
                    type="caption"
                    style={{ color: speed === s ? "rgba(255,255,255,0.7)" : theme.textSecondary, fontSize: 10 }}
                  >
                    {SPEED_CONFIGS[s].capSol} SOL
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable
            style={styles.advancedToggle}
            onPress={() => setShowAdvanced(!showAdvanced)}
          >
            <ThemedText type="caption" style={{ color: theme.accent }}>
              {showAdvanced ? "Hide Advanced" : "Advanced"}
            </ThemedText>
            <Feather
              name={showAdvanced ? "chevron-up" : "chevron-down"}
              size={16}
              color={theme.accent}
            />
          </Pressable>

          {showAdvanced && (
            <View style={[styles.advancedSection, { backgroundColor: theme.backgroundDefault }]}>
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
                Max Priority Fee Cap: {(customCapSol ?? SPEED_CONFIGS[speed].capSol).toFixed(4)} SOL
              </ThemedText>
              <View style={styles.capButtons}>
                {[0.001, 0.005, 0.01, 0.02].map((cap) => (
                  <Pressable
                    key={cap}
                    style={({ pressed }) => [
                      styles.capButton,
                      {
                        backgroundColor: customCapSol === cap ? theme.accent : theme.backgroundSecondary,
                        opacity: pressed ? 0.8 : 1,
                      },
                    ]}
                    onPress={() => setCustomCapSol(cap)}
                  >
                    <ThemedText
                      type="caption"
                      style={{ color: customCapSol === cap ? "#fff" : theme.text, fontWeight: "500" }}
                    >
                      {cap}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              {(customCapSol || 0) > 0.01 && (
                <View style={[styles.warningNote, { backgroundColor: "#F59E0B15" }]}>
                  <Feather name="alert-triangle" size={14} color="#F59E0B" />
                  <ThemedText type="caption" style={{ color: "#F59E0B", marginLeft: Spacing.xs, flex: 1 }}>
                    High fee cap may result in expensive transactions
                  </ThemedText>
                </View>
              )}
            </View>
          )}
        </View>
      </KeyboardAwareScrollViewCompat>

      <View style={[styles.ctaContainer, { paddingBottom: insets.bottom + Spacing.md, backgroundColor: theme.backgroundRoot }]}>
        <Pressable
          style={({ pressed }) => [
            styles.swapCta,
            {
              backgroundColor: quote && !isSwapping ? theme.accent : theme.backgroundSecondary,
              opacity: quote && !isSwapping ? (pressed ? 0.9 : 1) : 0.5,
            },
          ]}
          onPress={handleSwapPress}
          disabled={!quote || isSwapping}
        >
          {isSwapping ? (
            <View style={styles.swappingRow}>
              <ActivityIndicator size="small" color="#fff" />
              <ThemedText type="body" style={{ color: "#fff", fontWeight: "600", marginLeft: Spacing.sm }}>
                {swapStatus || "Processing..."}
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="body" style={{ color: quote ? "#fff" : theme.textSecondary, fontWeight: "600" }}>
              {quote ? "Swap" : inputAmount ? "Getting quote..." : "Enter amount"}
            </ThemedText>
          )}
        </Pressable>
      </View>

      {renderTokenModal()}
      {renderConfirmModal()}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  swapCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
  },
  tokenSection: {
    marginBottom: Spacing.sm,
  },
  sectionLabel: {
    marginBottom: Spacing.sm,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tokenSelector: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
  selectorLogo: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: Spacing.sm,
  },
  selectorLogoPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: Spacing.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: "700",
  },
  maxButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  balanceRow: {
    marginTop: Spacing.xs,
  },
  outputRow: {
    minHeight: 48,
    justifyContent: "center",
  },
  swapDirectionButton: {
    alignItems: "center",
    marginVertical: Spacing.xs,
    zIndex: 1,
  },
  swapDirectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
  },
  quoteCard: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  quoteRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.md,
  },
  settingsSection: {
    marginTop: Spacing.lg,
  },
  settingsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  slippageButtons: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  slippageButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    minWidth: 50,
    alignItems: "center",
  },
  speedSection: {
    marginBottom: Spacing.sm,
  },
  speedButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  speedButton: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    borderWidth: 1,
  },
  advancedToggle: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: Spacing.md,
    gap: Spacing.xs,
  },
  advancedSection: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  capButtons: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  capButton: {
    flex: 1,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  warningNote: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.sm,
  },
  ctaContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  swapCta: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    alignItems: "center",
  },
  swappingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    flex: 1,
  },
  tokenModal: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    maxHeight: "70%",
  },
  tokenModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  closeButton: {
    padding: Spacing.xs,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  searchIcon: {
    marginRight: Spacing.sm,
  },
  tokenSearchInput: {
    flex: 1,
    paddingVertical: Spacing.md,
    fontSize: 16,
  },
  tokenList: {
    flex: 1,
  },
  tokenListContent: {
    paddingBottom: Spacing.xl,
  },
  tokenItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  tokenLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: Spacing.md,
  },
  tokenLogoPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: Spacing.md,
    justifyContent: "center",
    alignItems: "center",
  },
  tokenInfo: {
    flex: 1,
  },
  confirmModal: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.lg,
  },
  confirmTitle: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  confirmRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  speedBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  turboNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
  },
  confirmButtons: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.xl,
  },
  cancelButton: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    borderWidth: 1,
  },
  confirmButton: {
    flex: 2,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
});
