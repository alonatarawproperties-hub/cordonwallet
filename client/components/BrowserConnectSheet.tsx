import React from "react";
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { getFaviconUrl } from "@/store/browserStore";

interface Props {
  visible: boolean;
  siteName: string;
  siteUrl: string;
  siteIcon?: string;
  chain: "solana" | "evm";
  walletAddress: string;
  isConnecting?: boolean;
  onConnect: () => void;
  onDeny: () => void;
}

function extractDomain(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || "";
  }
}

function shortenAddress(address: string): string {
  if (!address) return "";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function BrowserConnectSheet({
  visible,
  siteName,
  siteUrl,
  siteIcon,
  chain,
  walletAddress,
  isConnecting = false,
  onConnect,
  onDeny,
}: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const domain = extractDomain(siteUrl);
  const iconUrl = siteIcon || getFaviconUrl(siteUrl);
  const chainLabel = chain === "solana" ? "Solana" : "Ethereum";
  const chainColor = chain === "solana" ? "#9945FF" : "#627EEA";

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onDeny}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onDeny} />

        <ThemedView style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <ThemedText type="h3">Connect Wallet</ThemedText>
            <Pressable onPress={onDeny} hitSlop={12}>
              <Feather name="x" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.content}>
            <View style={styles.dappSection}>
              <View style={[styles.iconContainer, { borderColor: theme.border }]}>
                <Image
                  source={{ uri: iconUrl }}
                  style={styles.dappIcon}
                  defaultSource={require("../../assets/images/icon.png")}
                />
              </View>
              <ThemedText type="h3" style={{ marginTop: Spacing.md, textAlign: "center" }}>
                {siteName || "Unknown dApp"}
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: Spacing.xs }}>
                {domain}
              </ThemedText>
            </View>

            <View style={[styles.explainerCard, { backgroundColor: theme.backgroundDefault }]}>
              <View style={[styles.explainerIcon, { backgroundColor: theme.success + "20" }]}>
                <Feather name="link" size={20} color={theme.success} />
              </View>
              <View style={{ flex: 1, marginLeft: Spacing.md }}>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  Connection Request
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 4 }}>
                  This site wants to view your wallet address and request transaction approvals.
                </ThemedText>
              </View>
            </View>

            <View style={[styles.infoCard, { backgroundColor: theme.backgroundDefault }]}>
              <View style={styles.infoRow}>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Network
                </ThemedText>
                <Badge label={chainLabel} variant="neutral" />
              </View>
              <View style={[styles.infoRow, { marginTop: Spacing.sm }]}>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Wallet
                </ThemedText>
                <ThemedText type="small" style={{ fontFamily: "monospace" }}>
                  {shortenAddress(walletAddress)}
                </ThemedText>
              </View>
            </View>

            <View style={[styles.permissionsCard, { backgroundColor: theme.backgroundDefault }]}>
              <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.md, fontWeight: "500" }}>
                This site will be able to:
              </ThemedText>
              <View style={styles.permissionItem}>
                <View style={[styles.checkIcon, { backgroundColor: theme.success + "20" }]}>
                  <Feather name="check" size={12} color={theme.success} />
                </View>
                <ThemedText type="small" style={{ marginLeft: Spacing.sm }}>
                  View your wallet address
                </ThemedText>
              </View>
              <View style={styles.permissionItem}>
                <View style={[styles.checkIcon, { backgroundColor: theme.success + "20" }]}>
                  <Feather name="check" size={12} color={theme.success} />
                </View>
                <ThemedText type="small" style={{ marginLeft: Spacing.sm }}>
                  Request transaction signatures
                </ThemedText>
              </View>
              <View style={styles.permissionItem}>
                <View style={[styles.xIcon, { backgroundColor: theme.danger + "20" }]}>
                  <Feather name="x" size={12} color={theme.danger} />
                </View>
                <ThemedText type="small" style={{ marginLeft: Spacing.sm, color: theme.textSecondary }}>
                  Cannot move funds without approval
                </ThemedText>
              </View>
            </View>

            <View style={[styles.firewallBadge, { backgroundColor: theme.accent + "15" }]}>
              <Feather name="shield" size={16} color={theme.accent} />
              <ThemedText type="small" style={{ marginLeft: Spacing.sm, color: theme.accent, fontWeight: "500" }}>
                Wallet Firewall Active
              </ThemedText>
            </View>
          </View>

          <View style={styles.buttons}>
            <Pressable
              onPress={onDeny}
              disabled={isConnecting}
              style={[
                styles.secondaryButton,
                { backgroundColor: theme.backgroundDefault, borderColor: theme.border }
              ]}
            >
              <ThemedText type="body" style={{ fontWeight: "600" }}>Deny</ThemedText>
            </Pressable>
            <Button
              onPress={onConnect}
              style={{ flex: 1, marginLeft: Spacing.sm }}
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting..." : "Connect"}
            </Button>
          </View>
        </ThemedView>
      </View>
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
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.lg,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(128,128,128,0.4)",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  content: {
    marginBottom: Spacing.lg,
  },
  dappSection: {
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  dappIcon: {
    width: 72,
    height: 72,
  },
  explainerCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  explainerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  infoCard: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  permissionsCard: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  permissionItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  checkIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  xIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  firewallBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  buttons: {
    flexDirection: "row",
  },
  secondaryButton: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
  },
});
