import React, { useState, useMemo } from "react";
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { getFaviconUrl } from "@/store/browserStore";
import { analyzeSignMessage, RiskLevel } from "@/lib/walletconnect/message-analyzer";
import { decodeSolanaTransaction, DecodedSolanaTransaction } from "@/lib/solana/decoder";

type SignType = "message" | "transaction";

interface Props {
  visible: boolean;
  siteName: string;
  siteUrl: string;
  siteIcon?: string;
  chain: "solana" | "evm";
  signType: SignType;
  message?: string;
  transactionData?: string;
  isSigning?: boolean;
  isDrainerBlocked?: boolean;
  drainerType?: "SetAuthority" | "Assign";
  onSign: () => void;
  onReject: () => void;
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

export function BrowserSignSheet({
  visible,
  siteName,
  siteUrl,
  siteIcon,
  chain,
  signType,
  message = "",
  transactionData,
  isSigning = false,
  isDrainerBlocked = false,
  drainerType,
  onSign,
  onReject,
}: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [showRawMessage, setShowRawMessage] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const domain = extractDomain(siteUrl);
  const iconUrl = siteIcon || getFaviconUrl(siteUrl);
  const chainLabel = chain === "solana" ? "Solana" : "Ethereum";

  const messageAnalysis = useMemo(() => {
    if (signType !== "message" || !message) return null;
    return analyzeSignMessage({
      message,
      dappDomain: domain,
      chain,
      isDomainVerified: true,
    });
  }, [signType, message, domain, chain]);

  const txDecoded = useMemo(() => {
    if (signType !== "transaction" || !transactionData) return null;
    try {
      return decodeSolanaTransaction(transactionData);
    } catch {
      return null;
    }
  }, [signType, transactionData]);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(message);
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 2000);
  };

  const getRiskColor = (level: RiskLevel | string) => {
    switch (level) {
      case "low":
      case "Low":
        return theme.success;
      case "medium":
      case "Medium":
        return theme.warning;
      case "high":
      case "High":
      case "Blocked":
        return theme.danger;
      default:
        return theme.textSecondary;
    }
  };

  const getRiskIcon = (level: RiskLevel | string) => {
    switch (level) {
      case "low":
      case "Low":
        return "check-circle";
      case "medium":
      case "Medium":
        return "alert-circle";
      default:
        return "alert-triangle";
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onReject}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onReject} />

        <ThemedView style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <ThemedText type="h3">
              {signType === "message" ? "Sign Message" : "Sign Transaction"}
            </ThemedText>
            <Pressable onPress={onReject} hitSlop={12}>
              <Feather name="x" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContent}>
            <View style={styles.dappRow}>
              <View style={[styles.iconContainer, { borderColor: theme.border }]}>
                <Image
                  source={{ uri: iconUrl }}
                  style={styles.dappIcon}
                  defaultSource={require("../../assets/images/icon.png")}
                />
              </View>
              <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {siteName || "Unknown Site"}
                  </ThemedText>
                  <View style={{ marginLeft: Spacing.xs }}>
                    <Badge label="Verified" variant="success" />
                  </View>
                </View>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  {domain}
                </ThemedText>
              </View>
              <Badge label={chainLabel} variant="neutral" />
            </View>

            {isDrainerBlocked ? (
              <View style={[styles.blockedCard, { backgroundColor: theme.danger + "20", borderColor: theme.danger }]}>
                <Feather name="shield-off" size={24} color={theme.danger} />
                <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                  <ThemedText type="body" style={{ fontWeight: "700", color: theme.danger }}>
                    WALLET DRAINER BLOCKED
                  </ThemedText>
                  <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 4 }}>
                    {drainerType === "SetAuthority"
                      ? "This transaction tries to change your token account ownership. If signed, an attacker would gain permanent control of your tokens."
                      : "This transaction tries to reassign your wallet to a malicious program. If signed, you would permanently lose access to your funds."}
                  </ThemedText>
                  <View style={[styles.blockedBadge, { backgroundColor: theme.danger + "30" }]}>
                    <Feather name="x-circle" size={14} color={theme.danger} />
                    <ThemedText type="small" style={{ marginLeft: Spacing.xs, color: theme.danger, fontWeight: "600" }}>
                      Signing blocked for your protection
                    </ThemedText>
                  </View>
                </View>
              </View>
            ) : null}

            {signType === "message" && messageAnalysis ? (
              <View>
                <View style={[styles.summaryCard, { backgroundColor: theme.backgroundDefault }]}>
                  <View style={styles.summaryHeader}>
                    <ThemedText type="body" style={{ fontWeight: "600" }}>
                      What you're signing
                    </ThemedText>
                    <Badge
                      label={messageAnalysis.riskLevel.charAt(0).toUpperCase() + messageAnalysis.riskLevel.slice(1) + " Risk"}
                      variant={messageAnalysis.riskLevel === "low" ? "success" : messageAnalysis.riskLevel === "medium" ? "warning" : "danger"}
                    />
                  </View>

                  <View style={[styles.purposeRow, { backgroundColor: theme.backgroundSecondary }]}>
                    <Feather
                      name={getRiskIcon(messageAnalysis.riskLevel) as any}
                      size={18}
                      color={getRiskColor(messageAnalysis.riskLevel)}
                    />
                    <ThemedText type="body" style={{ marginLeft: Spacing.sm, flex: 1 }}>
                      {messageAnalysis.purposeLabel}
                    </ThemedText>
                  </View>

                  <View style={[styles.impactRow, { backgroundColor: theme.accent + "10" }]}>
                    <Feather name="shield" size={16} color={theme.accent} />
                    <ThemedText type="small" style={{ marginLeft: Spacing.sm, flex: 1, color: theme.textSecondary }}>
                      This does NOT move funds or grant token approvals.
                    </ThemedText>
                  </View>
                </View>

                {messageAnalysis.warnings.length > 0 ? (
                  <View style={[styles.warningsCard, { backgroundColor: theme.danger + "15", borderColor: theme.danger }]}>
                    {messageAnalysis.warnings.map((warning, idx) => (
                      <View key={idx} style={styles.warningRow}>
                        <Feather name="alert-triangle" size={14} color={theme.danger} />
                        <ThemedText type="small" style={{ marginLeft: Spacing.xs, flex: 1, color: theme.textSecondary }}>
                          {warning}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                ) : null}

                <Pressable
                  onPress={() => setShowRawMessage(!showRawMessage)}
                  style={[styles.expandButton, { backgroundColor: theme.backgroundDefault }]}
                >
                  <ThemedText type="body" style={{ fontWeight: "500" }}>
                    View raw message
                  </ThemedText>
                  <Feather name={showRawMessage ? "chevron-up" : "chevron-down"} size={20} color={theme.textSecondary} />
                </Pressable>

                {showRawMessage ? (
                  <View style={[styles.rawCard, { backgroundColor: theme.backgroundDefault }]}>
                    <ScrollView style={{ maxHeight: 120 }} nestedScrollEnabled>
                      <ThemedText type="small" style={{ fontFamily: "monospace", lineHeight: 18 }}>
                        {message}
                      </ThemedText>
                    </ScrollView>
                    <Pressable
                      onPress={handleCopy}
                      style={[styles.copyButton, { borderColor: theme.border }]}
                    >
                      <Feather name={copied ? "check" : "copy"} size={14} color={theme.textSecondary} />
                      <ThemedText type="small" style={{ color: theme.textSecondary, marginLeft: Spacing.xs }}>
                        {copied ? "Copied!" : "Copy message"}
                      </ThemedText>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}

            {signType === "transaction" && !isDrainerBlocked ? (
              <View>
                <View style={[styles.txCard, { backgroundColor: theme.backgroundDefault }]}>
                  <View style={styles.txRow}>
                    <ThemedText type="small" style={{ color: theme.textSecondary }}>
                      Request Type
                    </ThemedText>
                    <Badge label="Transaction" variant="neutral" />
                  </View>
                  <View style={styles.txRow}>
                    <ThemedText type="small" style={{ color: theme.textSecondary }}>
                      Network
                    </ThemedText>
                    <ThemedText type="body" style={{ fontWeight: "500" }}>
                      {chainLabel}
                    </ThemedText>
                  </View>
                </View>

                {txDecoded ? (
                  <View style={[styles.riskCard, { backgroundColor: getRiskColor(txDecoded.riskLevel) + "15", borderColor: getRiskColor(txDecoded.riskLevel) }]}>
                    <Feather
                      name={getRiskIcon(txDecoded.riskLevel) as any}
                      size={18}
                      color={getRiskColor(txDecoded.riskLevel)}
                    />
                    <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                      <ThemedText type="small" style={{ fontWeight: "600", color: getRiskColor(txDecoded.riskLevel) }}>
                        {txDecoded.riskLevel} Risk
                      </ThemedText>
                      <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 2 }}>
                        {txDecoded.riskReason}
                      </ThemedText>
                    </View>
                  </View>
                ) : (
                  <View style={[styles.infoCard, { backgroundColor: theme.warning + "15", borderColor: theme.warning }]}>
                    <Feather name="info" size={16} color={theme.warning} />
                    <ThemedText type="small" style={{ marginLeft: Spacing.sm, flex: 1, color: theme.textSecondary }}>
                      Review this transaction carefully. Only sign if you trust this site.
                    </ThemedText>
                  </View>
                )}

                {txDecoded ? (
                  <Pressable
                    onPress={() => setShowDetails(!showDetails)}
                    style={[styles.expandButton, { backgroundColor: theme.backgroundDefault }]}
                  >
                    <ThemedText type="body" style={{ fontWeight: "500" }}>
                      View transaction details
                    </ThemedText>
                    <Feather name={showDetails ? "chevron-up" : "chevron-down"} size={20} color={theme.textSecondary} />
                  </Pressable>
                ) : null}

                {showDetails && txDecoded ? (
                  <View style={[styles.detailsCard, { backgroundColor: theme.backgroundDefault }]}>
                    <View style={styles.detailRow}>
                      <ThemedText type="small" style={{ color: theme.textSecondary }}>
                        Instructions
                      </ThemedText>
                      <ThemedText type="small">{txDecoded.instructionCount}</ThemedText>
                    </View>
                    <View style={styles.detailRow}>
                      <ThemedText type="small" style={{ color: theme.textSecondary }}>
                        Programs
                      </ThemedText>
                      <View style={{ alignItems: "flex-end" }}>
                        {txDecoded.programLabels.slice(0, 3).map((label, idx) => (
                          <ThemedText key={idx} type="small">{label}</ThemedText>
                        ))}
                        {txDecoded.programLabels.length > 3 ? (
                          <ThemedText type="small" style={{ color: theme.textSecondary }}>
                            +{txDecoded.programLabels.length - 3} more
                          </ThemedText>
                        ) : null}
                      </View>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            {!isDrainerBlocked ? (
              <View style={[styles.firewallBadge, { backgroundColor: theme.accent + "15" }]}>
                <Feather name="shield" size={16} color={theme.accent} />
                <ThemedText type="small" style={{ marginLeft: Spacing.sm, color: theme.accent, fontWeight: "500" }}>
                  Protected by Wallet Firewall
                </ThemedText>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.buttons}>
            <Pressable
              onPress={onReject}
              disabled={isSigning}
              style={[
                styles.secondaryButton,
                { backgroundColor: theme.backgroundDefault, borderColor: theme.border }
              ]}
            >
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {isDrainerBlocked ? "Dismiss" : "Reject"}
              </ThemedText>
            </Pressable>
            {isDrainerBlocked ? (
              <View style={[styles.blockedSignButton, { backgroundColor: theme.danger + "30" }]}>
                <Feather name="shield-off" size={18} color={theme.danger} />
                <ThemedText type="body" style={{ fontWeight: "600", color: theme.danger, marginLeft: Spacing.xs }}>
                  Blocked
                </ThemedText>
              </View>
            ) : (
              <Button
                onPress={onSign}
                style={{ flex: 1, marginLeft: Spacing.sm }}
                disabled={isSigning}
              >
                {isSigning ? (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <ActivityIndicator size="small" color="#fff" />
                    <ThemedText type="body" style={{ color: "#fff", marginLeft: Spacing.xs }}>Signing...</ThemedText>
                  </View>
                ) : (
                  "Sign"
                )}
              </Button>
            )}
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
    maxHeight: "85%",
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
  scrollContent: {
    flexGrow: 0,
  },
  dappRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  dappIcon: {
    width: 48,
    height: 48,
  },
  blockedCard: {
    flexDirection: "row",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    marginBottom: Spacing.lg,
  },
  blockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.sm,
    alignSelf: "flex-start",
  },
  summaryCard: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  summaryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  purposeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.sm,
  },
  impactRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  warningsCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.xs,
  },
  expandButton: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  rawCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    marginTop: Spacing.sm,
  },
  txCard: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  txRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  riskCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  detailsCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: Spacing.sm,
  },
  firewallBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.lg,
  },
  buttons: {
    flexDirection: "row",
    marginTop: Spacing.md,
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
  blockedSignButton: {
    flex: 1,
    flexDirection: "row",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: Spacing.sm,
  },
});
