import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from "react";
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight, HeaderButton } from "@react-navigation/elements";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { VersionedTransaction, Keypair } from "@solana/web3.js";
import bs58 from "bs58";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useThemedAlert } from "@/components/ThemedAlert";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useWallet } from "@/lib/wallet-context";
import { getMnemonic, getWalletPrivateKey, unlockWithCachedKey } from "@/lib/wallet-engine";
import { deriveSolanaKeypair } from "@/lib/solana/keys";
import { useSolanaPortfolio, SolanaAsset } from "@/hooks/useSolanaPortfolio";
import {
  SwapSpeed,
  SPEED_CONFIGS,
  DEFAULT_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  SLIPPAGE_PRESETS,
  SLIPPAGE_STEP,
  SOL_MINT,
  USDC_MINT,
  LAMPORTS_PER_SOL,
  RPC_PRIMARY,
} from "@/constants/solanaSwap";
import { Connection } from "@solana/web3.js";
import { getQuoteEngine, QuoteEngineState, SwapRoute, PumpMeta } from "@/lib/quoteEngine";
import {
  TokenInfo,
  searchTokens,
  getPopularTokens,
  formatTokenAmount,
  parseTokenAmount,
  formatBaseUnits,
  getTokenByMint,
  getTokenLogoUri,
} from "@/services/solanaTokenList";
import {
  calculatePriceImpact,
  QuoteResponse,
} from "@/services/jupiter";
import {
  routeQuote,
  buildJupiter,
  buildPump,
  sendSignedTx,
  getStatus as getSwapStatus,
  quote as fetchJupiterQuote,
} from "@/services/solanaSwapApi";
import { classifyError, getExplorerUrl } from "@/services/txBroadcaster";
import { addSwapRecord, addDebugLog } from "@/services/swapStore";
import { getApiUrl, getApiHeaders } from "@/lib/query-client";
import {
  estimateFeeReserveLamports,
  lamportsToSolString,
  solToLamports,
  FeeReserveResult,
  formatFeeBreakdown,
} from "@/lib/solana/feeReserve";
import {
  estimateRequiredSolBufferLamports,
  formatBufferSol,
} from "@/lib/solana/swapBuffer";
// appendOutputFeeInstruction removed — output fee disabled (0 bps), replaced by Jupiter platform fee
import { likelyNeedsAtaRent } from "@/lib/solana/ataCheck";
import {
  getSuccessFeeLamports,
  getSuccessFeeSol,
  SUCCESS_FEE_SOL,
} from "@/constants/successFee";
import {
  tryChargeSuccessFeeNow,
  retryPendingFeesForCurrentWallet,
} from "@/services/successFeeService";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { useTokenSafetyScan, RiskLevel } from "@/hooks/useTokenSafetyScan";
import { TokenSafetyStrip } from "@/components/TokenSafetyStrip";
import { RiskGateModal } from "@/components/RiskGateModal";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Props = NativeStackScreenProps<RootStackParamList, "Swap">;

const CUSTOM_TOKENS_KEY = "swap_custom_tokens";
const MAX_CUSTOM_TOKENS = 25;
const SHOW_CORDON_FEE_UI = false; // hidden in open beta

function inferSpeedFromCap(capSol: number): SwapSpeed | null {
  if (Math.abs(capSol - SPEED_CONFIGS.standard.capSol) < 1e-9) return "standard";
  if (Math.abs(capSol - SPEED_CONFIGS.fast.capSol) < 1e-9) return "fast";
  if (Math.abs(capSol - SPEED_CONFIGS.turbo.capSol) < 1e-9) return "turbo";
  return null; // custom cap
}

function formatCapSol(x: number): string {
  if (x >= 0.01) return x.toFixed(2);
  if (x >= 0.001) return x.toFixed(4);
  return x.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

interface CustomTokenInfo extends TokenInfo {
  verified: boolean;
  sources: string[];
}

function isLikelySolanaMint(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
}

function shortMint(mint: string): string {
  if (mint.length <= 12) return mint;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

async function loadRecentCustomTokens(): Promise<CustomTokenInfo[]> {
  try {
    const data = await AsyncStorage.getItem(CUSTOM_TOKENS_KEY);
    if (data) {
      const tokens: CustomTokenInfo[] = JSON.parse(data);
      const validTokens = tokens.filter(t => t.symbol !== "UNKNOWN" && t.name !== "Unknown Token");
      if (validTokens.length !== tokens.length) {
        await AsyncStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(validTokens));
      }
      return validTokens;
    }
  } catch (err) {
    console.warn("[SwapScreen] Failed to load custom tokens:", err);
  }
  return [];
}

async function saveCustomToken(token: CustomTokenInfo, existing: CustomTokenInfo[]): Promise<CustomTokenInfo[]> {
  const filtered = existing.filter(t => t.mint !== token.mint);
  const updated = [token, ...filtered].slice(0, MAX_CUSTOM_TOKENS);
  try {
    await AsyncStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn("[SwapScreen] Failed to save custom token:", err);
  }
  return updated;
}


export default function SwapScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { activeWallet } = useWallet();
  const { showAlert } = useThemedAlert();
  
  const solanaAddress = activeWallet?.addresses?.solana;
  const { assets: solanaAssets, refresh: refreshPortfolio } = useSolanaPortfolio(solanaAddress);
  
  const preselectedToken = route?.params?.preselectedToken;

  // Animation for swap direction button
  const swapRotation = useSharedValue(0);
  const swapAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${swapRotation.value}deg` }],
  }));

  const [inputToken, setInputToken] = useState<TokenInfo | null>(null);
  const [outputToken, setOutputToken] = useState<TokenInfo | null>(null);
  const [inputAmount, setInputAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [speed, setSpeed] = useState<SwapSpeed>("fast");
  const [customCapSol, setCustomCapSol] = useState<number | null>(null);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customInputValue, setCustomInputValue] = useState("");
  const [liveQuotes, setLiveQuotes] = useState(false);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [swapRoute, setSwapRoute] = useState<SwapRoute>("none");
  const [pumpMeta, setPumpMeta] = useState<PumpMeta | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [isSwapping, setIsSwapping] = useState(false);
  const [swapStatus, setSwapStatus] = useState<string>("");

  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenModalType, setTokenModalType] = useState<"input" | "output">("input");
  const [tokenSearch, setTokenSearch] = useState("");
  const [tokenResults, setTokenResults] = useState<TokenInfo[]>([]);

  const [customTokenLoading, setCustomTokenLoading] = useState(false);
  const [customTokenError, setCustomTokenError] = useState<string | null>(null);
  const [customTokenResult, setCustomTokenResult] = useState<CustomTokenInfo | null>(null);
  const [recentCustomTokens, setRecentCustomTokens] = useState<CustomTokenInfo[]>([]);

  const [showSlippageModal, setShowSlippageModal] = useState(false);
  const [slippageInputText, setSlippageInputText] = useState("");
  const [needsAtaRent, setNeedsAtaRent] = useState(true);
  const [showFeeDetails, setShowFeeDetails] = useState(false);

  const [successFeeEnabled, setSuccessFeeEnabled] = useState(true);
  const [isPro] = useState(false); // Mock for now - Pro users skip success fee
  const [showRiskGateModal, setShowRiskGateModal] = useState(false);

  const quoteEngineRef = useRef(getQuoteEngine());
  
  const safetyScan = useTokenSafetyScan(
    outputToken?.mint,
    { routeSource: swapRoute === "pump" ? "pump" : swapRoute === "jupiter" ? "jupiter" : null }
  );

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

  const hasOutputTokenInWallet = useMemo(() => {
    if (!outputToken || !solanaAssets) return false;
    if (outputToken.mint === SOL_MINT) return true;
    return solanaAssets.some(a => a.mint?.toLowerCase() === outputToken.mint.toLowerCase());
  }, [outputToken, solanaAssets]);

  useEffect(() => {
    const checkAta = async () => {
      if (!outputToken || !activeWallet?.addresses?.solana) {
        setNeedsAtaRent(true);
        return;
      }
      if (outputToken.mint === SOL_MINT || hasOutputTokenInWallet) {
        setNeedsAtaRent(false);
        return;
      }
      try {
        const connection = new Connection(RPC_PRIMARY, { commitment: "confirmed" });
        const needs = await likelyNeedsAtaRent({
          owner: activeWallet.addresses.solana,
          mint: outputToken.mint,
          hasTokenInWalletList: hasOutputTokenInWallet,
          connection,
        });
        setNeedsAtaRent(needs);
      } catch {
        setNeedsAtaRent(true);
      }
    };
    checkAta();
  }, [outputToken?.mint, activeWallet?.addresses?.solana, hasOutputTokenInWallet]);

  const solBalanceLamports = useMemo(() => {
    const solBalance = getTokenBalance(SOL_MINT);
    return solToLamports(solBalance);
  }, [getTokenBalance]);

  const priorityCapLamports = useMemo(() => {
    const capSol = customCapSol ?? SPEED_CONFIGS[speed].capSol;
    return solToLamports(capSol);
  }, [customCapSol, speed]);

  const successFeeLamports = useMemo(() => {
    return getSuccessFeeLamports(speed, isPro, successFeeEnabled);
  }, [speed, isPro, successFeeEnabled]);

  const isOutputSolForFees = outputToken?.mint === SOL_MINT;
  
  const feeReserve: FeeReserveResult = useMemo(() => {
    return estimateFeeReserveLamports({
      solBalanceLamports,
      priorityCapLamports,
      needsAtaRent,
      isOutputSol: isOutputSolForFees,
      successFeeLamports,
    });
  }, [solBalanceLamports, priorityCapLamports, needsAtaRent, isOutputSolForFees, successFeeLamports]);

  const spendableSol = feeReserve.spendableLamports / LAMPORTS_PER_SOL;
  const isInputSol = inputToken?.mint === SOL_MINT;
  const isOutputSol = outputToken?.mint === SOL_MINT;
  const insufficientSolForFees = solBalanceLamports < feeReserve.reserveLamports;

  // Header with slippage button
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderButton onPress={() => setShowSlippageModal(true)}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: theme.glass }}>
            <Feather name="sliders" size={14} color={theme.text} />
            <ThemedText type="caption" style={{ fontWeight: "600" }}>
              {(slippageBps / 100).toFixed(1)}%
            </ThemedText>
          </View>
        </HeaderButton>
      ),
    });
  }, [navigation, theme, slippageBps]);

  useEffect(() => {
    const initTokens = async () => {
      // If we have a preselected token from navigation, use it as input
      if (preselectedToken) {
        const preselected: TokenInfo = {
          mint: preselectedToken.mint,
          symbol: preselectedToken.symbol,
          name: preselectedToken.name,
          decimals: preselectedToken.decimals,
          logoURI: preselectedToken.logoURI,
        };
        setInputToken(preselected);
        // Set SOL as output when coming from asset view (sell token for SOL)
        const sol = await getTokenByMint(SOL_MINT);
        if (sol && preselectedToken.mint !== SOL_MINT) {
          setOutputToken(sol);
        } else {
          const usdc = await getTokenByMint(USDC_MINT);
          if (usdc) setOutputToken(usdc);
        }
      } else {
        const sol = await getTokenByMint(SOL_MINT);
        const usdc = await getTokenByMint(USDC_MINT);
        if (sol) setInputToken(sol);
        if (usdc) setOutputToken(usdc);
      }
    };
    initTokens();
  }, [preselectedToken]);

  useEffect(() => {
    const engine = quoteEngineRef.current;
    
    const handleQuoteUpdate = (state: QuoteEngineState) => {
      setQuote(state.quote);
      setSwapRoute(state.route);
      setPumpMeta(state.pumpMeta);
      setIsQuoting(state.isUpdating);
      setQuoteError(state.error);
    };
    
    engine.setCallback(handleQuoteUpdate);
    
    return () => {
      engine.setCallback(null);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const engine = quoteEngineRef.current;
      engine.setFocused(true);
      
      if (activeWallet?.id && activeWallet?.addresses?.solana) {
        retryPendingFeesForCurrentWallet(
          activeWallet.id,
          activeWallet.addresses.solana
        ).then((result) => {
          if (result.paid > 0) {
            console.log(`[Swap] Retried ${result.retried} pending fees, ${result.paid} paid`);
          }
        }).catch(() => {});
      }
      
      return () => {
        engine.setFocused(false);
      };
    }, [activeWallet?.id, activeWallet?.addresses?.solana])
  );

  useEffect(() => {
    const engine = quoteEngineRef.current;
    
    if (!inputToken || !outputToken || !inputAmount || parseFloat(inputAmount) <= 0) {
      engine.clearQuote();
      setQuote(null);
      setSwapRoute("none");
      setPumpMeta(null);
      return;
    }

    const amountBaseUnits = parseTokenAmount(inputAmount, inputToken.decimals).toString();
    
    engine.updateParams({
      inputMint: inputToken.mint,
      outputMint: outputToken.mint,
      amount: amountBaseUnits,
      slippageBps,
      speedMode: speed,
    });
  }, [inputAmount, inputToken, outputToken, slippageBps, speed]);

  useEffect(() => {
    quoteEngineRef.current.setSpeedMode(speed);
  }, [speed]);

  useEffect(() => {
    loadRecentCustomTokens().then(setRecentCustomTokens);
  }, []);

  const isMintMode = useMemo(() => isLikelySolanaMint(tokenSearch), [tokenSearch]);

  const handleTokenSearch = async (query: string) => {
    setTokenSearch(query);
    setCustomTokenError(null);
    setCustomTokenResult(null);

    if (isLikelySolanaMint(query)) {
      const mint = query.trim();
      setCustomTokenLoading(true);

      const cached = recentCustomTokens.find(t => t.mint.toLowerCase() === mint.toLowerCase());
      const isCacheValid = cached && cached.symbol !== "UNKNOWN" && cached.name !== "Unknown Token";
      if (isCacheValid) {
        setCustomTokenResult(cached);
        setCustomTokenLoading(false);
        return;
      }

      try {
        const url = new URL(`/api/swap/solana/token/${mint}`, getApiUrl());
        const resp = await fetch(url.toString(), { headers: getApiHeaders() });
        const data = await resp.json();

        if (resp.ok && data.ok !== false) {
          const token: CustomTokenInfo = {
            mint: data.mint,
            symbol: data.symbol,
            name: data.name,
            decimals: data.decimals,
            logoURI: data.logoURI,
            verified: data.verified ?? false,
            sources: data.sources ?? ["on-chain"],
          };
          setCustomTokenResult(token);
          const updated = await saveCustomToken(token, recentCustomTokens);
          setRecentCustomTokens(updated);
        } else {
          setCustomTokenError(data.error || "Token not found");
        }
      } catch (err: any) {
        setCustomTokenError(err.message || "Failed to fetch token");
      } finally {
        setCustomTokenLoading(false);
      }
    } else if (query.trim()) {
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
    setCustomTokenResult(null);
    setCustomTokenError(null);
    setCustomTokenLoading(false);
    setShowTokenModal(true);
  };

  const selectToken = async (token: TokenInfo) => {
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
    setSwapRoute("none");
    setPumpMeta(null);
  };

  const swapTokens = () => {
    if (!inputToken || !outputToken) return;

    // Trigger rotation animation
    swapRotation.value = withSpring(swapRotation.value + 180, {
      damping: 15,
      stiffness: 200,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    const temp = inputToken;
    const nextInputAmount = quote
      ? formatBaseUnits(quote.outAmount, outputToken.decimals)
      : inputAmount;

    setInputToken(outputToken);
    setOutputToken(temp);
    setInputAmount(nextInputAmount);
    setQuote(null);
    setSwapRoute("none");
    setPumpMeta(null);
    setQuoteError(null);

    if (nextInputAmount && nextInputAmount !== "0") {
      const nextAmountBaseUnits = parseTokenAmount(nextInputAmount, outputToken.decimals).toString();
      const engine = quoteEngineRef.current;
      engine.clearQuote();
      engine.updateParams({
        inputMint: outputToken.mint,
        outputMint: inputToken.mint,
        amount: nextAmountBaseUnits,
        slippageBps,
        speedMode: speed,
      });
      engine.triggerImmediateFetch();
    }
  };

  const handleMaxPress = async () => {
    if (!inputToken || !activeWallet) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const balance = getTokenBalance(inputToken.mint);
    if (inputToken.mint === SOL_MINT) {
      if (spendableSol <= 0) {
        showAlert(
          "Insufficient SOL",
          `You need at least ${lamportsToSolString(feeReserve.reserveLamports)} SOL to cover fees for this swap.`
        );
        setInputAmount("0");
        return;
      }
      const formatted = spendableSol.toFixed(6).replace(/\.?0+$/, "");
      setInputAmount(formatted);
      if (__DEV__) {
        console.log("[Swap] MAX pressed - spendable:", spendableSol, "reserve:", lamportsToSolString(feeReserve.reserveLamports));
      }
    } else {
      const outputIsSol = outputToken?.mint === SOL_MINT;
      const requiredBuffer = estimateRequiredSolBufferLamports(priorityCapLamports, outputIsSol);
      
      if (solBalanceLamports < requiredBuffer) {
        showAlert(
          "Not Enough SOL for Fees",
          `Keep at least ${formatBufferSol(requiredBuffer)} SOL reserved to cover transaction fees.`
        );
        return;
      }
      
      setInputAmount(balance.toFixed(inputToken.decimals > 6 ? 6 : inputToken.decimals));
    }
  };

  // Instant swap: just need tokens + amount (no pre-fetched quote required)
  const canSwap = !!inputToken && !!outputToken && !!inputAmount && parseFloat(inputAmount) > 0 && !insufficientSolForFees;

  // ── INSTANT SWAP: TG-bot style — one tap, done ──
  // Uses existing server endpoints + client-side blockhash fix + parallel RPC send
  const executeInstantSwap = async () => {
    if (!inputToken || !outputToken || !activeWallet || !inputAmount || parseFloat(inputAmount) <= 0) return;

    const solanaAddr = activeWallet.addresses?.solana;
    if (!solanaAddr) {
      showAlert("Error", "No Solana address found");
      return;
    }

    setIsSwapping(true);
    setSwapStatus("Building...");

    let keypair: Keypair | null = null;

    try {
      // 1. Get keypair
      let mnemonic = await getMnemonic(activeWallet.id);
      if (!mnemonic) {
        const recovered = await unlockWithCachedKey().catch(() => false);
        if (recovered) mnemonic = await getMnemonic(activeWallet.id);
      }
      if (mnemonic) {
        const { secretKey } = deriveSolanaKeypair(mnemonic);
        keypair = Keypair.fromSecretKey(secretKey);
        secretKey.fill(0);
      } else {
        const pk = await getWalletPrivateKey(activeWallet.id);
        if (pk && pk.type === "solana") {
          keypair = Keypair.fromSecretKey(bs58.decode(pk.key));
        }
      }
      if (!keypair) {
        showAlert("Error", "Please unlock your wallet first");
        setIsSwapping(false);
        setSwapStatus("");
        return;
      }

      const amountBaseUnits = parseTokenAmount(inputAmount, inputToken.decimals).toString();

      // 2. Route detection + quote via existing endpoint
      const rqResult = await routeQuote({
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amount: amountBaseUnits,
        slippageBps,
      });

      if (!rqResult.ok) {
        throw new Error(rqResult.message || "No swap route available");
      }

      // 3. Build transaction — try pump first if applicable, auto-fallback to Jupiter
      let buildResult;
      let usedRoute: "pump" | "jupiter" = "jupiter";
      let jupiterQuote = rqResult.quoteResponse;

      const shouldTryPump = rqResult.route === "pump"
        && rqResult.pumpMeta?.isBondingCurve
        && !rqResult.pumpMeta?.isGraduated;

      if (shouldTryPump) {
        const isBuying = inputToken.mint === SOL_MINT;
        buildResult = await buildPump({
          userPublicKey: solanaAddr,
          mint: isBuying ? outputToken.mint : inputToken.mint,
          side: isBuying ? "buy" : "sell",
          amountSol: isBuying ? parseInt(amountBaseUnits) / 1_000_000_000 : undefined,
          amountTokens: !isBuying ? parseInt(amountBaseUnits) : undefined,
          slippageBps,
          speedMode: speed,
        });

        if (buildResult.ok && buildResult.swapTransactionBase64) {
          usedRoute = "pump";
        } else {
          // Pump failed (graduated, unavailable, etc.) — fall through to Jupiter
          console.log("[Swap] Pump build failed, falling back to Jupiter:", buildResult.message);
          buildResult = undefined;
        }
      }

      // Jupiter path — either primary route or fallback from pump
      if (!buildResult?.ok) {
        // Get Jupiter quote if we don't have one (pump route doesn't include Jupiter quote)
        if (!jupiterQuote) {
          const quoteResult = await fetchJupiterQuote({
            inputMint: inputToken.mint,
            outputMint: outputToken.mint,
            amount: amountBaseUnits,
            slippageBps,
          });
          if (!quoteResult.ok || !quoteResult.quote) {
            throw new Error(quoteResult.message || "No swap route available");
          }
          jupiterQuote = quoteResult.quote;
        }

        buildResult = await buildJupiter({
          userPublicKey: solanaAddr,
          quote: jupiterQuote,
          speedMode: speed,
          wrapAndUnwrapSol: true,
        });
        usedRoute = "jupiter";
      }

      if (!buildResult?.ok || !buildResult.swapTransactionBase64) {
        throw new Error(buildResult?.message || "Failed to build transaction");
      }

      setSwapStatus("Sending...");

      // 4. Sign the transaction (blockhash from server's RPC is used as-is)
      const txBuffer = Buffer.from(buildResult.swapTransactionBase64, "base64");
      const transaction = VersionedTransaction.deserialize(txBuffer);
      transaction.sign([keypair]);
      const signedBytes = transaction.serialize();
      const signedBase64 = Buffer.from(signedBytes).toString("base64");

      // 5. Send via server endpoint (uses paid Helius/Triton RPCs)
      const sendResult = await sendSignedTx({
        signedTransactionBase64: signedBase64,
        mode: speed,
      });

      if (!sendResult.ok || !sendResult.signature) {
        throw new Error(sendResult.message || "Failed to send transaction");
      }

      const signature = sendResult.signature;
      console.log(`[Swap] TX sent via server (${sendResult.rpc}): ${signature}`);

      // 6. Rebroadcast loop: keep resending via server + poll confirmation
      const REBROADCAST_INTERVAL = 2000;
      const MAX_REBROADCAST_TIME = 40000;
      const sendStart = Date.now();
      let confirmed = false;

      while (Date.now() - sendStart < MAX_REBROADCAST_TIME) {
        await new Promise(r => setTimeout(r, REBROADCAST_INTERVAL));

        // Check confirmation via server endpoint (uses paid RPC)
        try {
          const status = await getSwapStatus(signature);
          if (status.confirmed) {
            confirmed = true;
            console.log(`[Swap] TX confirmed after ${Date.now() - sendStart}ms`);
            break;
          }
          if (status.error) {
            throw new Error(`Transaction failed on-chain: ${status.error}`);
          }
        } catch (statusErr: any) {
          if (statusErr.message?.includes("failed on-chain")) throw statusErr;
        }

        // Resend via server (paid RPCs with retry logic built in)
        sendSignedTx({ signedTransactionBase64: signedBase64, mode: speed }).catch(() => {});
        setSwapStatus(`Sending... (${Math.round((Date.now() - sendStart) / 1000)}s)`);
      }

      // 7. Done!
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Use Jupiter quote for output estimate (pump doesn't provide one)
      const estOutAmount = jupiterQuote?.outAmount || rqResult.normalized?.outAmount;
      const outDisplay = estOutAmount && outputToken
        ? formatBaseUnits(estOutAmount, outputToken.decimals)
        : "";

      const routeLabel = usedRoute === "pump"
        ? "Pump.fun"
        : jupiterQuote?.routePlan
            ?.map((r: any) => r.swapInfo?.label || r.label)
            .filter(Boolean)
            .slice(0, 2)
            .join(" → ") || "Jupiter";

      // Record swap history
      await addSwapRecord({
        timestamp: Date.now(),
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        inputSymbol: inputToken.symbol,
        outputSymbol: outputToken.symbol,
        inputAmount,
        outputAmount: outDisplay,
        minReceived: (jupiterQuote?.otherAmountThreshold || rqResult.normalized?.minOut)
          ? formatBaseUnits(jupiterQuote?.otherAmountThreshold || rqResult.normalized?.minOut || "0", outputToken.decimals)
          : "0",
        slippageBps,
        mode: speed,
        capSol: customCapSol ?? SPEED_CONFIGS[speed].capSol,
        signature,
        status: confirmed ? "confirmed" : "submitted",
        timings: {},
        route: routeLabel,
        priceImpactPct: rqResult.normalized?.priceImpactPct || parseFloat(jupiterQuote?.priceImpactPct || "0"),
      });

      // Charge success fee only if confirmed
      if (confirmed && successFeeLamports > 0 && activeWallet?.id && solanaAddr) {
        tryChargeSuccessFeeNow(activeWallet.id, solanaAddr, successFeeLamports, signature).catch(() => {});
      }

      const alertTitle = confirmed ? "Swap Confirmed!" : "Swap Sent";
      const alertBody = confirmed
        ? outDisplay
          ? `Swapped ${inputAmount} ${inputToken.symbol} for ~${outDisplay} ${outputToken.symbol}`
          : `Swapped ${inputAmount} ${inputToken.symbol}`
        : `Transaction sent but not yet confirmed. Check explorer for status.`;

      showAlert(alertTitle, alertBody, [
        { text: "View", onPress: () => {
          const url = getExplorerUrl(signature);
          import("expo-web-browser").then(m => m.openBrowserAsync(url));
        }},
        { text: "OK" },
      ]);

      setInputAmount("");
      setQuote(null);
      refreshPortfolio();
    } catch (error: any) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const rawMsg = error.message || "Unknown error";
      await addDebugLog("error", "Instant swap failed", { error: rawMsg });
      console.error("[SwapScreen] Instant swap error:", rawMsg);

      const classified = classifyError(rawMsg);
      // Show raw error so we can actually debug what's happening
      const displayMsg = classified.category === "unknown"
        ? rawMsg
        : `${classified.userMessage}\n\n(${rawMsg.slice(0, 120)})`;
      showAlert("Swap Failed", displayMsg, [
        ...(classified.canRetry ? [{ text: "Retry", onPress: () => executeInstantSwap() }] : []),
        { text: "OK" },
      ]);
    } finally {
      if (keypair?.secretKey) keypair.secretKey.fill(0);
      setIsSwapping(false);
      setSwapStatus("");
    }
  };

  const handleSwapPress = async () => {
    if (!canSwap || !inputToken || !outputToken || !activeWallet) return;

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const riskLevel = safetyScan.result?.riskLevel;

    if (riskLevel === "HIGH" || riskLevel === "MEDIUM" || riskLevel === "NEEDS_DEEPER_SCAN") {
      setShowRiskGateModal(true);
      return;
    }

    executeInstantSwap();
  };

  const handleRiskGateProceed = () => {
    setShowRiskGateModal(false);
    executeInstantSwap();
  };

  const priceImpact = quote ? calculatePriceImpact(quote) : null;

  const renderSlippageModal = () => {
    const adjustSlippage = (delta: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const newValue = Math.max(SLIPPAGE_STEP, Math.min(MAX_SLIPPAGE_BPS, slippageBps + delta));
      setSlippageBps(newValue);
      setSlippageInputText((newValue / 100).toString());
    };

    const applySlippageInput = () => {
      const cleaned = slippageInputText.replace(/[^0-9.]/g, "");
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed) && parsed > 0) {
        const bps = Math.round(parsed * 100);
        const clamped = Math.max(SLIPPAGE_STEP, Math.min(MAX_SLIPPAGE_BPS, bps));
        setSlippageBps(clamped);
        setSlippageInputText((clamped / 100).toString());
      } else {
        setSlippageInputText((slippageBps / 100).toString());
      }
      Keyboard.dismiss();
    };

    const displayValue = slippageInputText;
    const isHighSlippage = slippageBps >= 500;
    const isLowSlippage = slippageBps <= 30;

    return (
      <Modal 
        visible={showSlippageModal} 
        transparent 
        animationType="slide"
        onShow={() => setSlippageInputText((slippageBps / 100).toString())}
      >
        <KeyboardAvoidingView 
          style={styles.slippageModalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable style={styles.slippageModalDismiss} onPress={() => { applySlippageInput(); setShowSlippageModal(false); }} />
          <Pressable style={[styles.slippageModalContent, { backgroundColor: theme.backgroundSecondary }]} onPress={applySlippageInput}>
            <View style={styles.slippageModalHandle} />
            
            <View style={styles.slippageHeader}>
              <ThemedText type="h3" style={{ fontWeight: "700" }}>
                Slippage Tolerance
              </ThemedText>
              <Pressable 
                style={[styles.slippageCloseBtn, { backgroundColor: theme.glass }]}
                onPress={() => { applySlippageInput(); setShowSlippageModal(false); }}
              >
                <Feather name="x" size={18} color={theme.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.slippageValueSection}>
              <LinearGradient
                colors={[theme.accent + "15", theme.accentSecondary + "10"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.slippageValueCard}
              >
                <View style={styles.slippageValueRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.slippageStepBtn,
                      { 
                        backgroundColor: theme.glass,
                        opacity: pressed ? 0.7 : 1,
                        borderColor: theme.glassBorder,
                      }
                    ]}
                    onPress={() => { applySlippageInput(); adjustSlippage(-SLIPPAGE_STEP); }}
                  >
                    <Feather name="chevron-down" size={20} color={theme.text} />
                  </Pressable>

                  <View style={styles.slippageValueCenter}>
                    <TextInput
                      style={[styles.slippageInput, { color: theme.text }]}
                      value={displayValue}
                      onChangeText={setSlippageInputText}
                      onBlur={applySlippageInput}
                      onSubmitEditing={applySlippageInput}
                      keyboardType="decimal-pad"
                      selectTextOnFocus
                      maxLength={5}
                      returnKeyType="done"
                    />
                    <ThemedText style={{ fontSize: 24, fontWeight: "600", color: theme.textSecondary, marginLeft: 2, marginTop: 8 }}>
                      %
                    </ThemedText>
                  </View>

                  <Pressable
                    style={({ pressed }) => [
                      styles.slippageStepBtn,
                      { 
                        backgroundColor: theme.glass,
                        opacity: pressed ? 0.7 : 1,
                        borderColor: theme.glassBorder,
                      }
                    ]}
                    onPress={() => { applySlippageInput(); adjustSlippage(SLIPPAGE_STEP); }}
                  >
                    <Feather name="chevron-up" size={20} color={theme.text} />
                  </Pressable>
                </View>

                {isHighSlippage ? (
                  <View style={[styles.slippageWarning, { backgroundColor: "#F59E0B" + "20" }]}>
                    <Feather name="alert-triangle" size={14} color="#F59E0B" />
                    <ThemedText type="caption" style={{ color: "#F59E0B", marginLeft: 6 }}>
                      High slippage may result in unfavorable rates
                    </ThemedText>
                  </View>
                ) : isLowSlippage ? (
                  <View style={[styles.slippageWarning, { backgroundColor: theme.accent + "20" }]}>
                    <Feather name="info" size={14} color={theme.accent} />
                    <ThemedText type="caption" style={{ color: theme.accent, marginLeft: 6 }}>
                      Low slippage may cause transaction to fail
                    </ThemedText>
                  </View>
                ) : null}
              </LinearGradient>
            </View>

            <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
              Quick Select
            </ThemedText>

            <View style={styles.slippageQuickSelect}>
              {SLIPPAGE_PRESETS.map((bps, index) => {
                const isActive = slippageBps === bps;
                const labels = ["Conservative", "Standard", "Moderate", "Aggressive"];
                return (
                  <Pressable
                    key={bps}
                    style={({ pressed }) => [
                      styles.slippageQuickBtn,
                      { 
                        borderColor: isActive ? theme.accent : theme.glassBorder,
                        opacity: pressed ? 0.8 : 1,
                      }
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSlippageBps(bps);
                      setSlippageInputText((bps / 100).toString());
                      Keyboard.dismiss();
                    }}
                  >
                    {isActive ? (
                      <LinearGradient
                        colors={[theme.accent, theme.accentSecondary]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.slippageQuickBtnInner}
                      >
                        <ThemedText type="body" style={{ fontWeight: "700", color: "#fff" }}>
                          {(bps / 100).toFixed(1)}%
                        </ThemedText>
                        <ThemedText type="caption" style={{ color: "rgba(255,255,255,0.8)", fontSize: 10 }}>
                          {labels[index]}
                        </ThemedText>
                      </LinearGradient>
                    ) : (
                      <View style={[styles.slippageQuickBtnInner, { backgroundColor: theme.glass }]}>
                        <ThemedText type="body" style={{ fontWeight: "600", color: theme.text }}>
                          {(bps / 100).toFixed(1)}%
                        </ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 10 }}>
                          {labels[index]}
                        </ThemedText>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  const selectCustomToken = () => {
    if (!customTokenResult || customTokenResult.decimals < 0) return;
    selectToken(customTokenResult);
  };

  const renderCustomTokenRow = () => {
    if (!isMintMode) return null;
    
    const mint = tokenSearch.trim();
    const canSelect = customTokenResult && customTokenResult.decimals >= 0 && !customTokenError;

    return (
      <View style={[styles.customTokenSection, { borderBottomColor: theme.border }]}>
        <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.textSecondary, marginBottom: Spacing.sm }]}>
          Custom Token
        </ThemedText>
        <Pressable
          style={({ pressed }) => [
            styles.tokenItem,
            { 
              backgroundColor: pressed && canSelect ? theme.backgroundSecondary : "transparent",
              opacity: canSelect ? 1 : 0.6,
            }
          ]}
          onPress={selectCustomToken}
          disabled={!canSelect}
        >
          {customTokenLoading ? (
            <View style={[styles.tokenLogoPlaceholder, { backgroundColor: theme.backgroundSecondary }]}>
              <ActivityIndicator size="small" color={theme.accent} />
            </View>
          ) : customTokenResult?.logoURI ? (
            <Image source={{ uri: customTokenResult.logoURI }} style={styles.tokenLogo} />
          ) : (
            <View style={[styles.tokenLogoPlaceholder, { backgroundColor: "#FF69B4" + "20" }]}>
              <ThemedText type="caption" style={{ color: "#FF69B4", fontWeight: "600" }}>
                {customTokenResult?.symbol?.slice(0, 2) || "?"}
              </ThemedText>
            </View>
          )}
          <View style={styles.tokenInfo}>
            <View style={styles.tokenTitleRow}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {customTokenResult?.symbol || "Loading..."}
              </ThemedText>
              {customTokenResult && !customTokenResult.verified && (
                <View style={[styles.unverifiedBadge, { backgroundColor: "#F59E0B" + "20" }]}>
                  <ThemedText type="caption" style={{ color: "#F59E0B", fontSize: 10 }}>Unverified</ThemedText>
                </View>
              )}
            </View>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {customTokenResult?.name || "Unknown Token"}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
              {shortMint(mint)}
            </ThemedText>
            {customTokenResult && (
              <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 10 }}>
                Decimals: {customTokenResult.decimals}
              </ThemedText>
            )}
          </View>
          {customTokenLoading && (
            <ActivityIndicator size="small" color={theme.accent} style={{ marginLeft: Spacing.sm }} />
          )}
        </Pressable>
        {customTokenError && (
          <ThemedText type="caption" style={{ color: "#EF4444", marginTop: Spacing.xs, marginLeft: Spacing.md }}>
            {customTokenError}
          </ThemedText>
        )}
      </View>
    );
  };

  const renderRecentCustomTokens = () => {
    if (isMintMode || tokenSearch.trim() || recentCustomTokens.length === 0) return null;

    return (
      <View style={[styles.customTokenSection, { borderBottomColor: theme.border }]}>
        <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.textSecondary, marginBottom: Spacing.sm }]}>
          Recent Custom Tokens
        </ThemedText>
        {recentCustomTokens.slice(0, 5).map((token) => (
          <Pressable
            key={token.mint}
            style={({ pressed }) => [
              styles.tokenItem,
              { backgroundColor: pressed ? theme.backgroundSecondary : "transparent" }
            ]}
            onPress={() => selectToken(token)}
          >
            {token.logoURI ? (
              <Image source={{ uri: token.logoURI }} style={styles.tokenLogo} />
            ) : (
              <View style={[styles.tokenLogoPlaceholder, { backgroundColor: "#FF69B4" + "20" }]}>
                <ThemedText type="caption" style={{ color: "#FF69B4", fontWeight: "600" }}>
                  {token.symbol.slice(0, 2)}
                </ThemedText>
              </View>
            )}
            <View style={styles.tokenInfo}>
              <View style={styles.tokenTitleRow}>
                <ThemedText type="body" style={{ fontWeight: "600" }}>{token.symbol}</ThemedText>
                {!token.verified && (
                  <View style={[styles.unverifiedBadge, { backgroundColor: "#F59E0B" + "20" }]}>
                    <ThemedText type="caption" style={{ color: "#F59E0B", fontSize: 10 }}>Unverified</ThemedText>
                  </View>
                )}
              </View>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>{token.name}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>{shortMint(token.mint)}</ThemedText>
            </View>
          </Pressable>
        ))}
      </View>
    );
  };

  const getModalTokenBalance = useCallback((mint: string): { balance: number; usdValue: number } => {
    if (!solanaAssets || solanaAssets.length === 0) return { balance: 0, usdValue: 0 };
    
    let asset;
    if (mint === SOL_MINT) {
      asset = solanaAssets.find(a => a.isNative);
    } else {
      asset = solanaAssets.find(a => a.mint?.toLowerCase() === mint.toLowerCase());
    }
    
    if (asset) {
      const bal = parseFloat(asset.balance.replace(/,/g, ""));
      const price = asset.priceUsd || 0;
      return { balance: bal, usdValue: bal * price };
    }
    return { balance: 0, usdValue: 0 };
  }, [solanaAssets]);

  const yourTokens = useMemo(() => {
    if (!solanaAssets || solanaAssets.length === 0) return [];
    const excludeMint = tokenModalType === "input" ? outputToken?.mint : inputToken?.mint;
    
    return solanaAssets
      .filter(a => {
        const mint = a.isNative ? SOL_MINT : a.mint;
        if (mint === excludeMint) return false;
        const bal = parseFloat(a.balance.replace(/,/g, ""));
        return bal > 0;
      })
      .map(a => {
        const bal = parseFloat(a.balance.replace(/,/g, ""));
        const usdValue = bal * (a.priceUsd || 0);
        const mint = a.isNative ? SOL_MINT : a.mint || "";
        const logoURI = a.logoUrl || getTokenLogoUri(mint);
        return {
          mint,
          symbol: a.symbol,
          name: a.name,
          decimals: a.decimals || 9,
          logoURI,
          balance: bal,
          usdValue,
          verified: true,
        };
      })
      .sort((a, b) => b.usdValue - a.usdValue);
  }, [solanaAssets, tokenModalType, inputToken, outputToken]);

  const renderTokenRow = (item: TokenInfo & { verified?: boolean }, showBalance = true) => {
    const { balance, usdValue } = getModalTokenBalance(item.mint);
    const isVerified = (item as any).verified !== false;
    
    return (
      <Pressable
        key={item.mint}
        style={({ pressed }) => [
          styles.tokenItemNew, 
          { backgroundColor: pressed ? theme.backgroundSecondary : "transparent" }
        ]}
        onPress={() => selectToken(item)}
      >
        {item.logoURI ? (
          <Image source={{ uri: item.logoURI }} style={styles.tokenLogoNew} />
        ) : (
          <View style={[styles.tokenLogoPlaceholderNew, { backgroundColor: theme.border }]}>
            <ThemedText type="body" style={{ color: theme.textSecondary, fontWeight: "600" }}>
              {item.symbol.slice(0, 2)}
            </ThemedText>
          </View>
        )}
        <View style={styles.tokenInfoNew}>
          <View style={styles.tokenSymbolRow}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>{item.symbol}</ThemedText>
            {isVerified && (
              <Feather name="check-circle" size={12} color="#22C55E" style={{ marginLeft: 4 }} />
            )}
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>{item.name}</ThemedText>
        </View>
        {showBalance && balance > 0 ? (
          <View style={styles.tokenBalanceColumn}>
            <ThemedText type="body" style={{ fontWeight: "600", textAlign: "right" }}>
              {balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "right" }}>
              ${usdValue.toFixed(2)}
            </ThemedText>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const renderTokenModal = () => (
    <Modal visible={showTokenModal} transparent={false} animationType="slide" onRequestClose={() => setShowTokenModal(false)} presentationStyle="fullScreen">
      <View style={[styles.fullScreenModal, { backgroundColor: theme.backgroundDefault }]}>
        <View style={[styles.fullScreenHeader, { paddingTop: insets.top + Spacing.sm }]}>
          <Pressable style={styles.headerBackButton} onPress={() => setShowTokenModal(false)}>
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
          <ThemedText type="body" style={styles.headerTitle}>
            {tokenModalType === "input" ? "You Pay" : "You Receive"}
          </ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        <View style={[styles.searchContainerNew, { backgroundColor: theme.backgroundSecondary }]}>
          <Feather name="search" size={18} color={theme.textSecondary} />
          <TextInput
            style={[styles.tokenSearchInputNew, { color: theme.text }]}
            placeholder="Search tokens"
            placeholderTextColor={theme.textSecondary}
            value={tokenSearch}
            onChangeText={handleTokenSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {tokenSearch.length > 0 ? (
            <Pressable onPress={() => { setTokenSearch(""); setTokenResults(getPopularTokens()); }}>
              <Feather name="x-circle" size={18} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {renderCustomTokenRow()}

        <FlatList
          data={tokenSearch ? tokenResults : [...yourTokens, ...tokenResults.filter(t => !yourTokens.find(y => y.mint === t.mint))]}
          keyExtractor={(item) => item.mint}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.lg }}
          ListHeaderComponent={
            !tokenSearch && yourTokens.length > 0 ? (
              <View style={styles.sectionHeaderContainer}>
                <ThemedText type="caption" style={[styles.sectionHeaderText, { color: theme.textSecondary }]}>
                  Your Tokens
                </ThemedText>
              </View>
            ) : null
          }
          renderItem={({ item, index }) => {
            const isFirstPopular = !tokenSearch && yourTokens.length > 0 && index === yourTokens.length;
            return (
              <View>
                {isFirstPopular ? (
                  <View style={styles.sectionHeaderContainer}>
                    <ThemedText type="caption" style={[styles.sectionHeaderText, { color: theme.textSecondary }]}>
                      Popular
                    </ThemedText>
                  </View>
                ) : null}
                {renderTokenRow(item)}
              </View>
            );
          }}
          style={styles.tokenListNew}
          ListEmptyComponent={
            tokenSearch ? (
              <View style={styles.emptyState}>
                <Feather name="search" size={48} color={theme.textSecondary} />
                <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: Spacing.md }}>
                  No tokens found
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: Spacing.xs }}>
                  Try searching by contract address
                </ThemedText>
              </View>
            ) : null
          }
        />
      </View>
    </Modal>
  );

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.betaBanner, { backgroundColor: theme.accent + "15", borderColor: theme.accent + "30" }]}>
          <Feather name="zap" size={14} color={theme.accent} />
          <ThemedText type="caption" style={{ color: theme.accent, flex: 1 }}>
            Phase I Beta — Solana swaps only
          </ThemedText>
          <View style={[styles.betaBadge, { backgroundColor: theme.accent + "25" }]}>
            <ThemedText type="caption" style={{ color: theme.accent, fontWeight: "700", fontSize: 10 }}>BETA</ThemedText>
          </View>
        </View>
        <View style={[styles.swapCard, { backgroundColor: theme.glass, borderColor: theme.glassBorder }]}>
          <View style={styles.tokenSection}>
            <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              You pay
            </ThemedText>
            <Pressable
              style={({ pressed }) => [
                styles.tokenSelector, 
                { 
                  backgroundColor: theme.glass,
                  borderColor: pressed ? theme.accent : theme.glassBorder,
                }
              ]}
              onPress={() => openTokenModal("input")}
            >
              {inputToken?.logoURI ? (
                <Image source={{ uri: inputToken.logoURI }} style={styles.selectorLogo} />
              ) : (
                <View style={[styles.selectorLogoPlaceholder, { backgroundColor: theme.accent + "20" }]}>
                  <ThemedText type="body" style={{ color: theme.accent, fontWeight: "700" }}>
                    {inputToken?.symbol.slice(0, 2) || "?"}
                  </ThemedText>
                </View>
              )}
              <ThemedText type="body" style={{ fontWeight: "600", flex: 1 }}>
                {inputToken?.symbol || "Select token"}
              </ThemedText>
              <Feather name="chevron-down" size={16} color={theme.textSecondary} />
            </Pressable>
            <View style={styles.amountRow}>
              <TextInput
                style={[styles.amountInput, { color: theme.text }]}
                placeholder="0.0"
                placeholderTextColor={theme.textSecondary + "60"}
                keyboardType="decimal-pad"
                value={inputAmount}
                onChangeText={setInputAmount}
              />
              <Pressable 
                style={({ pressed }) => [
                  styles.maxButton, 
                  { 
                    backgroundColor: pressed ? theme.accent : theme.accent + "15",
                    borderColor: theme.accent + "40",
                  }
                ]} 
                onPress={handleMaxPress}
              >
                <ThemedText type="caption" style={{ color: theme.accent, fontWeight: "700", letterSpacing: 0.5 }}>MAX</ThemedText>
              </Pressable>
            </View>
            {inputToken ? (
              <View style={styles.balanceRow}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  Balance: {inputTokenBalance.toFixed(inputToken.decimals > 6 ? 6 : 4)} {inputToken.symbol}
                </ThemedText>
                {isInputSol ? (
                  <Pressable 
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                    onPress={() => setShowFeeDetails(!showFeeDetails)}
                  >
                    <ThemedText type="caption" style={{ color: theme.accent }}>
                      Spendable: {spendableSol.toFixed(4)}
                    </ThemedText>
                    <Feather name={showFeeDetails ? "chevron-up" : "info"} size={12} color={theme.accent} />
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {isInputSol && showFeeDetails ? (
              <View style={[styles.feeDetailsCard, { backgroundColor: theme.glass, borderColor: theme.glassBorder }]}>
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.xs }}>
                  Reserved for fees (max):
                </ThemedText>
                {formatFeeBreakdown(feeReserve.breakdown).map((line, i) => (
                  <ThemedText key={i} type="caption" style={{ color: theme.textSecondary, paddingLeft: Spacing.sm }}>
                    {line}
                  </ThemedText>
                ))}
                <ThemedText type="caption" style={{ color: theme.text, fontWeight: "600", marginTop: Spacing.xs }}>
                  Total: {lamportsToSolString(feeReserve.reserveLamports)} SOL
                </ThemedText>
              </View>
            ) : null}
          </View>

          <Pressable 
            style={({ pressed }) => [
              styles.swapDirectionButton,
              { transform: [{ scale: pressed ? 0.92 : 1 }], opacity: pressed ? 0.9 : 1 }
            ]} 
            onPress={swapTokens}
          >
            <View style={[styles.swapDirectionOuter, { borderColor: theme.accent + "30" }]}>
              <Animated.View style={swapAnimatedStyle}>
                <LinearGradient
                  colors={[theme.accent, theme.accentSecondary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.swapDirectionIcon}
                >
                  <View style={styles.swapArrowsContainer}>
                    <Feather name="chevron-down" size={16} color="#fff" style={styles.swapArrowTop} />
                    <Feather name="chevron-up" size={16} color="#fff" style={styles.swapArrowBottom} />
                  </View>
                </LinearGradient>
              </Animated.View>
            </View>
          </Pressable>

          <View style={styles.tokenSection}>
            <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              You receive
            </ThemedText>
            <Pressable
              style={({ pressed }) => [
                styles.tokenSelector, 
                { 
                  backgroundColor: theme.glass,
                  borderColor: pressed ? theme.accent : theme.glassBorder,
                }
              ]}
              onPress={() => openTokenModal("output")}
            >
              {outputToken?.logoURI ? (
                <Image source={{ uri: outputToken.logoURI }} style={styles.selectorLogo} />
              ) : (
                <View style={[styles.selectorLogoPlaceholder, { backgroundColor: theme.accent + "20" }]}>
                  <ThemedText type="body" style={{ color: theme.accent, fontWeight: "700" }}>
                    {outputToken?.symbol.slice(0, 2) || "?"}
                  </ThemedText>
                </View>
              )}
              <ThemedText type="body" style={{ fontWeight: "600", flex: 1 }}>
                {outputToken?.symbol || "Select token"}
              </ThemedText>
              <Feather name="chevron-down" size={16} color={theme.textSecondary} />
            </Pressable>
            <View style={styles.outputRow}>
              {quote ? (
                <View style={styles.outputWithIndicator}>
                  <ThemedText style={styles.outputAmount}>
                    {formatTokenAmount(formatBaseUnits(quote.outAmount, outputToken?.decimals || 6), outputToken?.decimals || 6)}
                  </ThemedText>
                  {isQuoting ? (
                    <View style={styles.updatingIndicator}>
                      <ActivityIndicator size="small" color={theme.accent} />
                      <ThemedText type="caption" style={{ color: theme.textSecondary, marginLeft: Spacing.xs }}>
                        Updating...
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              ) : isQuoting ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <ThemedText style={[styles.outputAmount, { color: theme.textSecondary + "60" }]}>0.0</ThemedText>
              )}
            </View>
            {outputToken ? (
              <TokenSafetyStrip
                result={safetyScan.result}
                isScanning={safetyScan.isScanning}
                timeAgo={safetyScan.timeAgo}
                onRescan={safetyScan.rescan}
              />
            ) : null}
          </View>
        </View>

        {quote && swapRoute === "jupiter" ? (
          <View style={[styles.quoteCard, { backgroundColor: theme.glass, borderColor: theme.accent + "40" }]}>
            <View style={styles.quoteRow}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Route</ThemedText>
              <View style={[styles.routeBadge, { backgroundColor: theme.accent + "20" }]}>
                <ThemedText type="caption" style={{ fontWeight: "600", color: theme.accent }}>Jupiter</ThemedText>
              </View>
            </View>
            <View style={styles.quoteRow}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Rate</ThemedText>
              <ThemedText type="small" style={{ fontWeight: "600" }}>
                1 {inputToken?.symbol} = {(parseFloat(formatBaseUnits(quote.outAmount, outputToken?.decimals || 6)) / parseFloat(inputAmount || "1")).toFixed(4)} {outputToken?.symbol}
              </ThemedText>
            </View>
            <View style={styles.quoteRow}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Price Impact</ThemedText>
              <ThemedText
                type="small"
                style={{
                  fontWeight: "600",
                  color: priceImpact?.severity === "critical" ? "#EF4444" :
                         priceImpact?.severity === "high" ? "#F59E0B" :
                         priceImpact?.severity === "medium" ? "#EAB308" : theme.success
                }}
              >
                {priceImpact?.impactPct.toFixed(2)}%
              </ThemedText>
            </View>
            <View style={[styles.quoteRow, { borderBottomWidth: 0 }]}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Min received</ThemedText>
              <ThemedText type="small" style={{ fontWeight: "600" }}>
                {formatTokenAmount(formatBaseUnits(quote.otherAmountThreshold, outputToken?.decimals || 6), outputToken?.decimals || 6)} {outputToken?.symbol}
              </ThemedText>
            </View>
          </View>
        ) : null}

        {swapRoute === "pump" && pumpMeta ? (
          <View style={[styles.quoteCard, { backgroundColor: theme.glass, borderColor: "#FF69B4" + "40" }]}>
            <View style={styles.quoteRow}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Route</ThemedText>
              <View style={[styles.routeBadge, { backgroundColor: "#FF69B4" + "20" }]}>
                <ThemedText type="caption" style={{ fontWeight: "600", color: "#FF69B4" }}>Pump.fun</ThemedText>
              </View>
            </View>
            <View style={styles.quoteRow}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Type</ThemedText>
              <ThemedText type="small" style={{ fontWeight: "600" }}>
                {inputToken?.mint === SOL_MINT ? "Buy" : "Sell"}
              </ThemedText>
            </View>
            <View style={styles.quoteRow}>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Slippage</ThemedText>
              <ThemedText type="small" style={{ fontWeight: "600" }}>{(slippageBps / 100).toFixed(1)}%</ThemedText>
            </View>
            <View style={[styles.quoteRow, { borderBottomWidth: 0 }]}>
              <ThemedText type="caption" style={{ color: "#F59E0B" }}>
                Pump trades don't show exact output. Review carefully.
              </ThemedText>
            </View>
          </View>
        ) : null}

        {quoteError ? (
          <View style={[styles.errorCard, { backgroundColor: theme.danger + "15", borderColor: theme.danger + "30" }]}>
            <Feather name="alert-circle" size={18} color={theme.danger} />
            <ThemedText type="small" style={{ color: theme.danger, marginLeft: Spacing.sm, flex: 1 }}>
              {quoteError}
            </ThemedText>
          </View>
        ) : null}

        {insufficientSolForFees && !isInputSol ? (
          <View style={[styles.insufficientBanner, { backgroundColor: theme.danger + "15", borderColor: theme.danger + "30", borderWidth: 1 }]}>
            <Feather name="alert-triangle" size={18} color={theme.danger} />
            <View style={{ flex: 1, marginLeft: Spacing.sm }}>
              <ThemedText type="small" style={{ color: theme.danger, fontWeight: "600" }}>
                Need at least {lamportsToSolString(feeReserve.reserveLamports)} SOL for fees
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.danger, marginTop: 2, opacity: 0.85 }}>
                Your SOL: {lamportsToSolString(solBalanceLamports)}.{isOutputSol ? " This swap to SOL needs extra for temporary WSOL rent." : ""} Add more SOL to proceed.
              </ThemedText>
            </View>
          </View>
        ) : null}

        <View style={styles.settingsSection}>
          <View style={styles.speedSection}>
            <ThemedText type="small" style={{ color: theme.textSecondary, fontWeight: "500", marginBottom: Spacing.md }}>
              Speed Mode
            </ThemedText>
            <View style={styles.speedButtons}>
              {(["standard", "fast", "turbo"] as SwapSpeed[]).map((s) => {
                const isActive = !showCustomInput && speed === s && customCapSol === null;
                return (
                  <Pressable
                    key={s}
                    style={({ pressed }) => [
                      styles.speedButton,
                      {
                        backgroundColor: theme.glass,
                        borderColor: isActive ? theme.accent : theme.glassBorder,
                        opacity: pressed ? 0.9 : 1,
                        shadowColor: isActive ? theme.accent : "transparent",
                        shadowOffset: { width: 0, height: 0 },
                        shadowOpacity: isActive ? 0.4 : 0,
                        shadowRadius: 8,
                      },
                    ]}
                    onPress={() => {
                      setSpeed(s);
                      setCustomCapSol(null);
                      setShowCustomInput(false);
                      setCustomInputValue("");
                    }}
                  >
                    {isActive ? (
                      <LinearGradient
                        colors={[theme.accent, theme.accentSecondary]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.speedButtonGradientBg}
                      >
                        <ThemedText type="small" style={{ color: "#fff", fontWeight: "700" }}>
                          {SPEED_CONFIGS[s].label}
                        </ThemedText>
                        <ThemedText type="caption" style={{ color: "rgba(255,255,255,0.8)", fontSize: 11 }}>
                          {SPEED_CONFIGS[s].capSol} SOL
                        </ThemedText>
                      </LinearGradient>
                    ) : (
                      <View style={styles.speedButtonContent}>
                        <ThemedText type="small" style={{ color: theme.text, fontWeight: "600" }}>
                          {SPEED_CONFIGS[s].label}
                        </ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
                          {SPEED_CONFIGS[s].capSol} SOL
                        </ThemedText>
                      </View>
                    )}
                  </Pressable>
                );
              })}
              <Pressable
                style={({ pressed }) => [
                  styles.speedButton,
                  {
                    backgroundColor: theme.glass,
                    borderColor: showCustomInput || customCapSol !== null ? theme.accent : theme.glassBorder,
                    opacity: pressed ? 0.9 : 1,
                    shadowColor: showCustomInput || customCapSol !== null ? theme.accent : "transparent",
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: showCustomInput || customCapSol !== null ? 0.4 : 0,
                    shadowRadius: 8,
                  },
                ]}
                onPress={() => {
                  setShowCustomInput(true);
                  if (customCapSol !== null) {
                    setCustomInputValue(String(customCapSol));
                  }
                }}
              >
                {showCustomInput || customCapSol !== null ? (
                  <LinearGradient
                    colors={[theme.accent, theme.accentSecondary]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.speedButtonGradientBg}
                  >
                    <ThemedText type="small" style={{ color: "#fff", fontWeight: "700" }}>
                      Custom
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: "rgba(255,255,255,0.8)", fontSize: 11 }}>
                      {customCapSol !== null ? `${customCapSol} SOL` : "Set fee"}
                    </ThemedText>
                  </LinearGradient>
                ) : (
                  <View style={styles.speedButtonContent}>
                    <ThemedText type="small" style={{ color: theme.text, fontWeight: "600" }}>
                      Custom
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
                      Set fee
                    </ThemedText>
                  </View>
                )}
              </Pressable>
            </View>
            
            {showCustomInput ? (
              <View style={[styles.customFeeInput, { backgroundColor: theme.glass, borderColor: theme.glassBorder }]}>
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
                  Enter max priority fee (SOL)
                </ThemedText>
                <View style={{ flexDirection: "row", alignItems: "center", gap: Spacing.sm }}>
                  <TextInput
                    style={[
                      styles.customFeeTextInput,
                      { 
                        backgroundColor: theme.backgroundSecondary, 
                        color: theme.text,
                        borderColor: theme.glassBorder,
                      }
                    ]}
                    value={customInputValue}
                    onChangeText={setCustomInputValue}
                    placeholder="0.005"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    autoFocus
                  />
                  <Pressable
                    style={({ pressed }) => [
                      styles.customFeeApplyBtn,
                      { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }
                    ]}
                    onPress={() => {
                      const val = parseFloat(customInputValue);
                      if (!isNaN(val) && val > 0) {
                        setCustomCapSol(val);
                        const matchedSpeed = inferSpeedFromCap(val);
                        if (matchedSpeed) setSpeed(matchedSpeed);
                      }
                      setShowCustomInput(false);
                    }}
                  >
                    <ThemedText type="small" style={{ color: "#fff", fontWeight: "600" }}>Apply</ThemedText>
                  </Pressable>
                </View>
                {parseFloat(customInputValue) > 0.01 ? (
                  <View style={[styles.warningNote, { backgroundColor: theme.warning + "15", borderColor: theme.warning + "30", marginTop: Spacing.sm }]}>
                    <Feather name="alert-triangle" size={14} color={theme.warning} />
                    <ThemedText type="caption" style={{ color: theme.warning, marginLeft: Spacing.sm, flex: 1 }}>
                      High fee may result in expensive transactions
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            ) : null}
            
            {!showCustomInput && speed === "turbo" && customCapSol === null ? (
              <ThemedText type="caption" style={[styles.speedHint, { color: theme.textSecondary }]}>
                Turbo uses higher priority fees for faster confirmation.
              </ThemedText>
            ) : null}
            
            {!showCustomInput && customCapSol !== null ? (
              <ThemedText type="caption" style={[styles.speedHint, { color: theme.accent }]}>
                Custom priority cap: {formatCapSol(customCapSol)} SOL
              </ThemedText>
            ) : null}
          </View>

          <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: Spacing.sm, fontSize: 10, textAlign: "center", opacity: 0.7 }}>
            Fees: Priority (shown above) + network (~0.00001 SOL). Jupiter platform fee is currently disabled.
          </ThemedText>

          {SHOW_CORDON_FEE_UI ? (
            <View style={[styles.successFeeSection, { backgroundColor: theme.glass, borderColor: theme.glassBorder }]}>
              <View style={styles.successFeeHeader}>
                <View style={{ flex: 1 }}>
                  <ThemedText type="small" style={{ color: theme.text, fontWeight: "600" }}>
                    Cordon Success Fee
                  </ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>
                    {successFeeLamports > 0 
                      ? `${getSuccessFeeSol(speed, isPro, successFeeEnabled)} SOL — charged only if swap confirms.`
                      : "Free for Pro users"}
                  </ThemedText>
                </View>
                <Pressable
                  style={[
                    styles.successFeeToggle,
                    { backgroundColor: successFeeEnabled && !isPro ? theme.accent : theme.backgroundSecondary },
                  ]}
                  onPress={() => {
                    if (isPro) {
                      setSuccessFeeEnabled(!successFeeEnabled);
                    }
                  }}
                  disabled={!isPro}
                >
                  <View
                    style={[
                      styles.successFeeKnob,
                      { 
                        backgroundColor: "#fff",
                        transform: [{ translateX: successFeeEnabled && !isPro ? 18 : 2 }],
                      },
                    ]}
                  />
                </Pressable>
              </View>
              {!isPro ? (
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: Spacing.sm }}>
                  This does not affect slippage or swap price.
                </ThemedText>
              ) : (
                <ThemedText type="caption" style={{ color: theme.success, marginTop: Spacing.sm }}>
                  Pro member — success fee waived.
                </ThemedText>
              )}
            </View>
          ) : null}

        </View>
      </KeyboardAwareScrollViewCompat>

      <View style={[styles.ctaContainer, { paddingBottom: insets.bottom + 70, backgroundColor: theme.backgroundRoot }]}>
        {canSwap && !isSwapping ? (
          <Pressable
            style={({ pressed }) => [
              styles.swapCtaWrapper,
              { 
                transform: [{ scale: pressed ? 0.98 : 1 }],
                opacity: pressed ? 0.95 : 1,
              },
            ]}
            onPress={handleSwapPress}
          >
            <LinearGradient
              colors={[theme.accent, theme.accentSecondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.swapCtaGradient}
            >
              <ThemedText type="body" style={{ color: "#fff", fontWeight: "600", fontSize: 15 }}>
                Swap
              </ThemedText>
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable
            style={[
              styles.swapCtaDisabled,
              { backgroundColor: theme.glass, borderColor: theme.glassBorder },
            ]}
            onPress={handleSwapPress}
            disabled={!canSwap || isSwapping}
          >
            {isSwapping ? (
              <View style={styles.swappingRow}>
                <ActivityIndicator size="small" color={theme.accent} />
                <ThemedText type="body" style={{ color: theme.text, fontWeight: "600", marginLeft: Spacing.sm }}>
                  {swapStatus || "Processing..."}
                </ThemedText>
              </View>
            ) : insufficientSolForFees ? (
              <ThemedText type="body" style={{ color: theme.danger, fontWeight: "600" }}>
                Need more SOL for fees
              </ThemedText>
            ) : (
              <ThemedText type="body" style={{ color: theme.textSecondary, fontWeight: "600" }}>
                {inputAmount ? "Getting quote..." : "Enter amount"}
              </ThemedText>
            )}
          </Pressable>
        )}
      </View>

      {renderTokenModal()}
      {renderSlippageModal()}
      {safetyScan.result ? (
        <RiskGateModal
          visible={showRiskGateModal}
          result={safetyScan.result}
          onCancel={() => setShowRiskGateModal(false)}
          onProceed={handleRiskGateProceed}
          onRescan={() => {
            setShowRiskGateModal(false);
            safetyScan.rescan();
          }}
        />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.xl,
  },
  betaBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  betaBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  swapCard: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  tokenSection: {
    marginBottom: Spacing.md,
  },
  sectionLabel: {
    marginBottom: Spacing.md,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "600",
  },
  tokenSelector: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
  },
  selectorLogo: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: Spacing.sm,
  },
  selectorLogoPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  maxButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  balanceRow: {
    marginTop: Spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  feeDetailsCard: {
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  insufficientBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
    gap: Spacing.xs,
  },
  outputRow: {
    minHeight: 40,
    justifyContent: "center",
  },
  outputAmount: {
    fontSize: 26,
    fontWeight: "600",
    color: "#10B981",
    letterSpacing: -0.3,
  },
  outputWithIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  updatingIndicator: {
    flexDirection: "row",
    alignItems: "center",
  },
  swapDirectionButton: {
    alignItems: "center",
    marginVertical: Spacing.md,
    zIndex: 1,
  },
  swapDirectionOuter: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(102, 126, 234, 0.08)",
  },
  swapDirectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#667EEA",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  swapArrowsContainer: {
    width: 24,
    height: 24,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  swapArrowTop: {
    position: "absolute",
    top: 0,
    left: 1,
  },
  swapArrowBottom: {
    position: "absolute",
    bottom: 0,
    right: 1,
  },
  quoteCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginTop: Spacing.lg,
    borderWidth: 1,
  },
  quoteRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(128,128,128,0.15)",
  },
  routeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.lg,
    borderWidth: 1,
  },
  settingsSection: {
    marginTop: Spacing.xl,
  },
  settingsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  slippageButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  slippagePillGradient: {
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
  slippagePillInner: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    alignItems: "center",
  },
  slippagePill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
  },
  slippageModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  slippageModalDismiss: {
    flex: 1,
  },
  slippageModalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.xl,
    paddingTop: Spacing.md,
  },
  slippageModalHandle: {
    width: 36,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: Spacing.lg,
  },
  slippageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  slippageCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  slippageValueSection: {
    marginBottom: Spacing.xl,
  },
  slippageValueCard: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
  },
  slippageValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  slippageStepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  slippageValueCenter: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
  },
  slippageInput: {
    fontSize: 56,
    fontWeight: "800",
    letterSpacing: -2,
    textAlign: "center",
    minWidth: 100,
    padding: 0,
  },
  slippageWarning: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  slippageQuickSelect: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  slippageQuickBtn: {
    flex: 1,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    overflow: "hidden",
  },
  slippageQuickBtnInner: {
    paddingVertical: Spacing.md,
    alignItems: "center",
    gap: 2,
  },
  speedSection: {
    marginBottom: Spacing.md,
  },
  speedButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  speedButton: {
    flex: 1,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    overflow: "hidden",
  },
  speedButtonGradientBg: {
    padding: Spacing.sm,
    alignItems: "center",
    gap: 2,
  },
  speedButtonContent: {
    padding: Spacing.sm,
    alignItems: "center",
    gap: 2,
  },
  speedHint: {
    marginTop: Spacing.md,
    fontSize: 12,
    textAlign: "center",
  },
  customFeeInput: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
  },
  customFeeTextInput: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    fontSize: 16,
  },
  customFeeApplyBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  warningNote: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.md,
    borderWidth: 1,
  },
  successFeeSection: {
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
  },
  successFeeHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  successFeeToggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
  },
  successFeeKnob: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  ctaContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  swapCtaWrapper: {
    shadowColor: "#667EEA",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  swapCtaGradient: {
    height: 48,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  swapCtaDisabled: {
    height: 48,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
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
  tokenTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  customTokenSection: {
    borderBottomWidth: 1,
    paddingBottom: Spacing.md,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  unverifiedBadge: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
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
  fullScreenModal: {
    flex: 1,
  },
  fullScreenHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerBackButton: {
    padding: Spacing.sm,
    marginLeft: -Spacing.sm,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
  },
  headerSpacer: {
    width: 40,
  },
  tokenBalanceColumn: {
    alignItems: "flex-end",
  },
  tokenItemNew: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    minHeight: 64,
  },
  tokenLogoNew: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  tokenLogoPlaceholderNew: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  tokenInfoNew: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  tokenSymbolRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  searchContainerNew: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  tokenSearchInputNew: {
    flex: 1,
    paddingVertical: Spacing.md,
    fontSize: 16,
  },
  tokenListNew: {
    flex: 1,
  },
  sectionHeaderContainer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: Spacing.xl * 2,
  },
});
