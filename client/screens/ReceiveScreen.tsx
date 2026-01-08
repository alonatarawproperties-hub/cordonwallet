import { View, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useState } from "react";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { NetworkBadge } from "@/components/NetworkBadge";
import { useWallet } from "@/lib/wallet-context";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Receive">;

export default function ReceiveScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { walletAddress } = route.params;
  const { selectedNetwork } = useWallet();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(walletAddress);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing["2xl"] }]}>
      <View style={styles.content}>
        <View style={[styles.networkCard, { backgroundColor: theme.backgroundDefault }]}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Receiving on
          </ThemedText>
          <NetworkBadge networkId={selectedNetwork} selected />
        </View>

        <View style={[styles.qrPlaceholder, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <View style={[styles.qrBox, { backgroundColor: theme.text }]}>
            <View style={[styles.qrInner, { backgroundColor: theme.backgroundRoot }]} />
          </View>
          <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: Spacing.lg }}>
            Scan QR code to receive funds
          </ThemedText>
        </View>

        <View style={[styles.addressCard, { backgroundColor: theme.backgroundDefault }]}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Your Address
          </ThemedText>
          <ThemedText type="body" style={styles.address} selectable>
            {walletAddress}
          </ThemedText>
        </View>

        <View style={[styles.warningCard, { backgroundColor: theme.warning + "15", borderColor: theme.warning + "40" }]}>
          <Feather name="alert-triangle" size={20} color={theme.warning} />
          <ThemedText type="small" style={{ color: theme.warning, flex: 1 }}>
            Only send EVM-compatible tokens to this address. Sending other tokens may result in permanent loss.
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
  qrPlaceholder: {
    alignItems: "center",
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  qrBox: {
    width: 160,
    height: 160,
    borderRadius: BorderRadius.md,
    padding: Spacing["2xl"],
    alignItems: "center",
    justifyContent: "center",
  },
  qrInner: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.sm,
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
