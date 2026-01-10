import { useState, useEffect, useCallback } from "react";
import { 
  View, 
  StyleSheet, 
  Modal, 
  Pressable, 
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { formatUnits, parseUnits } from "viem";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { getERC20Balance, isBalanceError } from "@/lib/blockchain/balances";
import { getChainById } from "@/lib/blockchain/chains";
import { getSpenderLabel, shortenAddress } from "@/lib/approvals";

export interface CapAllowanceParams {
  chainId: number;
  tokenAddress: `0x${string}`;
  tokenSymbol: string;
  tokenName?: string;
  tokenDecimals: number;
  spender: `0x${string}`;
  ownerAddress: `0x${string}`;
  originalAmount?: bigint;
}

export interface CapAllowanceResult {
  cappedAmount: bigint;
  cappedAmountFormatted: string;
}

interface CapAllowanceSheetProps {
  visible: boolean;
  params: CapAllowanceParams | null;
  onConfirm: (result: CapAllowanceResult) => void;
  onCancel: () => void;
}

type PresetKey = "25" | "50" | "100" | "custom";

export function CapAllowanceSheet({ 
  visible, 
  params,
  onConfirm, 
  onCancel 
}: CapAllowanceSheetProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  
  const [customAmount, setCustomAmount] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>("100");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOverCapConfirm, setShowOverCapConfirm] = useState(false);

  const chainName = params ? getChainById(params.chainId)?.name || "Unknown" : "";
  const spenderLabel = params 
    ? getSpenderLabel(params.chainId, params.spender) || shortenAddress(params.spender)
    : "";

  useEffect(() => {
    if (visible && params) {
      loadBalance();
      setCustomAmount("");
      setSelectedPreset("100");
      setError(null);
      setShowOverCapConfirm(false);
    }
  }, [visible, params]);

  const loadBalance = async () => {
    if (!params) return;
    
    setIsLoadingBalance(true);
    try {
      const result = await getERC20Balance({
        tokenAddress: params.tokenAddress,
        owner: params.ownerAddress,
        chainId: params.chainId,
        decimals: params.tokenDecimals,
        symbol: params.tokenSymbol,
      });

      if (isBalanceError(result)) {
        setBalance(null);
      } else {
        setBalance(result.raw);
      }
    } catch {
      setBalance(null);
    } finally {
      setIsLoadingBalance(false);
    }
  };

  const calculatePresetAmount = useCallback((preset: PresetKey): bigint => {
    if (!balance || !params) return 0n;
    
    switch (preset) {
      case "25":
        return balance / 4n;
      case "50":
        return balance / 2n;
      case "100":
        return balance;
      case "custom":
        try {
          if (!customAmount || customAmount === "" || customAmount === ".") return 0n;
          return parseUnits(customAmount, params.tokenDecimals);
        } catch {
          return 0n;
        }
      default:
        return balance;
    }
  }, [balance, params, customAmount]);

  const formatAmount = (amount: bigint): string => {
    if (!params) return "0";
    const formatted = formatUnits(amount, params.tokenDecimals);
    const num = parseFloat(formatted);
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    if (num >= 1) return num.toFixed(2);
    return num.toFixed(6);
  };

  const selectedAmount = calculatePresetAmount(selectedPreset);
  const formattedSelectedAmount = formatAmount(selectedAmount);
  
  const isOverCap = balance !== null && selectedAmount > (balance * 105n / 100n);
  const isValidAmount = selectedAmount > 0n;

  const handlePresetSelect = (preset: PresetKey) => {
    setSelectedPreset(preset);
    setError(null);
    setShowOverCapConfirm(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleConfirm = () => {
    if (!isValidAmount) {
      setError("Please enter a valid amount");
      return;
    }

    if (isOverCap && !showOverCapConfirm) {
      setShowOverCapConfirm(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onConfirm({
      cappedAmount: selectedAmount,
      cappedAmountFormatted: `${formattedSelectedAmount} ${params?.tokenSymbol || ""}`,
    });
  };

  const handleCancel = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onCancel();
  };

  if (!params) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView 
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={handleCancel} />
        
        <ThemedView style={[
          styles.sheet, 
          { paddingBottom: insets.bottom + Spacing.lg }
        ]}>
          <View style={styles.handle} />
          
          <View style={styles.header}>
            <ThemedText type="h3">Set Allowance Limit</ThemedText>
            <Pressable onPress={handleCancel} hitSlop={12}>
              <Feather name="x" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>

          <View style={[styles.infoCard, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.infoRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>Token</ThemedText>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {params.tokenSymbol}
              </ThemedText>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.infoRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>Spender</ThemedText>
              <ThemedText type="body">{spenderLabel}</ThemedText>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.infoRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>Network</ThemedText>
              <ThemedText type="body">{chainName}</ThemedText>
            </View>
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            <View style={styles.infoRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>Your Balance</ThemedText>
              {isLoadingBalance ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <ThemedText type="body">
                  {balance !== null ? `${formatAmount(balance)} ${params.tokenSymbol}` : "Unknown"}
                </ThemedText>
              )}
            </View>
          </View>

          <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
            Quick presets (% of balance)
          </ThemedText>

          <View style={styles.presets}>
            {(["25", "50", "100"] as PresetKey[]).map((preset) => (
              <Pressable
                key={preset}
                style={[
                  styles.presetButton,
                  { 
                    backgroundColor: selectedPreset === preset ? theme.accent : theme.backgroundDefault,
                    borderColor: selectedPreset === preset ? theme.accent : theme.border,
                  }
                ]}
                onPress={() => handlePresetSelect(preset)}
              >
                <ThemedText 
                  type="body" 
                  style={{ 
                    color: selectedPreset === preset ? "#FFFFFF" : theme.text,
                    fontWeight: "600" 
                  }}
                >
                  {preset}%
                </ThemedText>
              </Pressable>
            ))}
            <Pressable
              style={[
                styles.presetButton,
                { 
                  backgroundColor: selectedPreset === "custom" ? theme.accent : theme.backgroundDefault,
                  borderColor: selectedPreset === "custom" ? theme.accent : theme.border,
                }
              ]}
              onPress={() => handlePresetSelect("custom")}
            >
              <ThemedText 
                type="body" 
                style={{ 
                  color: selectedPreset === "custom" ? "#FFFFFF" : theme.text,
                  fontWeight: "600" 
                }}
              >
                Custom
              </ThemedText>
            </Pressable>
          </View>

          {selectedPreset === "custom" ? (
            <View style={styles.customInputContainer}>
              <TextInput
                style={[
                  styles.customInput,
                  { 
                    backgroundColor: theme.backgroundDefault,
                    borderColor: error ? theme.danger : theme.border,
                    color: theme.text,
                  }
                ]}
                placeholder="Enter amount"
                placeholderTextColor={theme.textSecondary}
                value={customAmount}
                onChangeText={(text) => {
                  setCustomAmount(text.replace(/[^0-9.]/g, ""));
                  setError(null);
                  setShowOverCapConfirm(false);
                }}
                keyboardType="decimal-pad"
                autoFocus
              />
              <View style={[styles.symbolBadge, { backgroundColor: theme.accent + "20" }]}>
                <ThemedText type="small" style={{ color: theme.accent, fontWeight: "600" }}>
                  {params.tokenSymbol}
                </ThemedText>
              </View>
            </View>
          ) : null}

          {error ? (
            <ThemedText type="small" style={{ color: theme.danger, marginTop: Spacing.sm }}>
              {error}
            </ThemedText>
          ) : null}

          <View style={[styles.summaryCard, { backgroundColor: theme.accent + "10", borderColor: theme.accent + "30" }]}>
            <Feather name="info" size={18} color={theme.accent} />
            <ThemedText type="small" style={{ color: theme.accent, flex: 1 }}>
              This spender can spend up to {formattedSelectedAmount} {params.tokenSymbol}. You can revoke anytime.
            </ThemedText>
          </View>

          {showOverCapConfirm ? (
            <View style={[styles.warningCard, { backgroundColor: theme.danger + "15", borderColor: theme.danger + "40" }]}>
              <Feather name="alert-triangle" size={18} color={theme.danger} />
              <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>
                Amount exceeds your balance by more than 5%. Are you sure you want to proceed?
              </ThemedText>
            </View>
          ) : null}

          {isOverCap && !showOverCapConfirm ? (
            <View style={[styles.warningCard, { backgroundColor: theme.warning + "15", borderColor: theme.warning + "40" }]}>
              <Feather name="alert-circle" size={18} color={theme.warning} />
              <ThemedText type="small" style={{ color: theme.warning, flex: 1 }}>
                This amount exceeds your current balance. You'll be asked to confirm.
              </ThemedText>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable 
              style={[styles.cancelButton, { borderColor: theme.border }]}
              onPress={handleCancel}
            >
              <ThemedText type="body" style={{ fontWeight: "600" }}>Cancel</ThemedText>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Button 
                onPress={handleConfirm}
                disabled={!isValidAmount || isLoadingBalance}
              >
                {showOverCapConfirm ? "Confirm Anyway" : "Set Limit"}
              </Button>
            </View>
          </View>
        </ThemedView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: BorderRadius["2xl"],
    borderTopRightRadius: BorderRadius["2xl"],
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#666",
    alignSelf: "center",
    marginBottom: Spacing.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  infoCard: {
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
  divider: {
    height: 1,
    marginVertical: Spacing.sm,
  },
  presets: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  presetButton: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  customInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  customInput: {
    flex: 1,
    height: 52,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    fontSize: 18,
  },
  symbolBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  summaryCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  cancelButton: {
    height: 52,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
