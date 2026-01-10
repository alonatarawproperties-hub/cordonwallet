import { View, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import QRCode from "react-native-qrcode-svg";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useWallet } from "@/lib/wallet-context";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { ChainType } from "@/lib/types";

type Props = NativeStackScreenProps<RootStackParamList, "Receive">;

const CHAIN_OPTIONS: { id: ChainType; name: string; color: string }[] = [
  { id: "evm", name: "EVM", color: "#627EEA" },
  { id: "solana", name: "Solana", color: "#9945FF" },
];

export default function ReceiveScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { walletAddress, solanaAddress } = route.params;
  const { activeWallet } = useWallet();
  const [copied, setCopied] = useState(false);
  const [selectedChainType, setSelectedChainType] = useState<ChainType>(
    activeWallet?.walletType === "solana-only" ? "solana" : "evm"
  );

  const isSolanaOnly = activeWallet?.walletType === "solana-only";
  const displayAddress = selectedChainType === "solana" 
    ? (solanaAddress || activeWallet?.addresses?.solana || "") 
    : walletAddress;

  const handleCopy = async () => {
    await Clipboard.setStringAsync(displayAddress);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getChainLabel = () => {
    if (selectedChainType === "solana") return "Solana";
    return "EVM Networks";
  };

  const getWarningText = () => {
    if (selectedChainType === "solana") {
      return "Only send SOL or Solana SPL tokens to this address. Sending tokens from other networks may result in permanent loss.";
    }
    return "Only send EVM-compatible tokens (Ethereum, Polygon, BNB Chain) to this address. Sending other tokens may result in permanent loss.";
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing["2xl"] }]}>
      <View style={styles.content}>
        {!isSolanaOnly ? (
          <View style={[styles.chainSelectorCard, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Receiving on
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
              Receiving on
            </ThemedText>
            <View style={[styles.solanaBadge, { backgroundColor: "#9945FF20" }]}>
              <View style={[styles.chainDot, { backgroundColor: "#9945FF" }]} />
              <ThemedText type="small" style={{ color: "#9945FF", fontWeight: "600" }}>
                Solana
              </ThemedText>
            </View>
          </View>
        )}

        <View style={[styles.qrContainer, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.qrWrapper}>
            <QRCode
              value={displayAddress || "loading"}
              size={180}
              backgroundColor="white"
              color="black"
            />
          </View>
          <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: Spacing.lg }}>
            Scan QR code to receive funds
          </ThemedText>
        </View>

        <View style={[styles.addressCard, { backgroundColor: theme.backgroundDefault }]}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Your {getChainLabel()} Address
          </ThemedText>
          <ThemedText type="body" style={styles.address} selectable>
            {displayAddress}
          </ThemedText>
        </View>

        <View style={[styles.warningCard, { backgroundColor: theme.warning + "15", borderColor: theme.warning + "40" }]}>
          <Feather name="alert-triangle" size={20} color={theme.warning} />
          <ThemedText type="small" style={{ color: theme.warning, flex: 1 }}>
            {getWarningText()}
          </ThemedText>
        </View>
      </View>

      <View style={styles.footer}>
        <Button onPress={handleCopy}>
          <View style={styles.buttonContent}>
            <Feather name={copied ? "check" : "copy"} size={18} color="#FFFFFF" />
            <ThemedText style={{ color: "#FFFFFF", fontWeight: "600", marginLeft: Spacing.sm }}>
              {copied ? "Copied!" : "Copy Address"}
            </ThemedText>
          </View>
        </Button>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing["2xl"],
  },
  content: {
    flex: 1,
    gap: Spacing.xl,
  },
  networkCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  chainSelectorCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
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
  qrContainer: {
    alignItems: "center",
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
  },
  qrWrapper: {
    padding: Spacing.lg,
    backgroundColor: "#FFFFFF",
    borderRadius: BorderRadius.md,
  },
  addressCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  address: {
    fontFamily: "monospace",
    fontSize: 13,
  },
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.md,
  },
  footer: {
    marginTop: Spacing.lg,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
});
