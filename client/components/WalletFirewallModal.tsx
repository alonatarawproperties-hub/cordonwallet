import { Modal, View, StyleSheet, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { TransferRestriction } from "@/lib/solana/token2022Guard";

export type RiskLevel = "low" | "medium" | "high" | "blocked" | "scam";

export interface RestrictionBanner {
  type: "danger" | "warning" | "info";
  title: string;
  message: string;
  icon?: keyof typeof Feather.glyphMap;
}

export interface WalletFirewallModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  amount: string;
  tokenSymbol: string;
  recipient: string;
  network: string;
  fee: string;
  riskLevel: RiskLevel;
  riskReasons: string[];
  restrictions: RestrictionBanner[];
  isBlocked: boolean;
  isLoading?: boolean;
  confirmText?: string;
}

export function WalletFirewallModal({
  visible,
  onClose,
  onConfirm,
  amount,
  tokenSymbol,
  recipient,
  network,
  fee,
  riskLevel,
  riskReasons,
  restrictions,
  isBlocked,
  isLoading,
  confirmText = "Confirm Send",
}: WalletFirewallModalProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

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

  const getRiskIcon = (level: RiskLevel): keyof typeof Feather.glyphMap => {
    switch (level) {
      case "low": return "shield";
      case "medium": return "alert-triangle";
      case "high": return "alert-octagon";
      case "blocked": return "x-octagon";
      case "scam": return "alert-octagon";
    }
  };

  const getBannerStyle = (type: "danger" | "warning" | "info") => {
    switch (type) {
      case "danger": return { bg: theme.danger + "15", border: theme.danger, icon: theme.danger };
      case "warning": return { bg: theme.warning + "15", border: theme.warning, icon: theme.warning };
      case "info": return { bg: theme.accent + "15", border: theme.accent, icon: theme.accent };
    }
  };

  const getBannerIcon = (type: "danger" | "warning" | "info", customIcon?: keyof typeof Feather.glyphMap): keyof typeof Feather.glyphMap => {
    if (customIcon) return customIcon;
    switch (type) {
      case "danger": return "x-circle";
      case "warning": return "alert-triangle";
      case "info": return "info";
    }
  };

  const shortenAddress = (addr: string) => {
    if (addr.length <= 16) return addr;
    return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={[
          styles.sheet,
          { 
            backgroundColor: theme.backgroundSecondary,
            paddingBottom: insets.bottom + Spacing.lg,
          }
        ]}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />

          <View style={styles.header}>
            <View style={[styles.shieldBadge, { backgroundColor: theme.accent + "20" }]}>
              <Feather name="shield" size={20} color={theme.accent} />
            </View>
            <ThemedText type="h3" style={styles.title}>
              Wallet Firewall
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeButton}>
              <Feather name="x" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ThemedText type="caption" style={[styles.subtitle, { color: theme.textSecondary }]}>
            Before You Sign
          </ThemedText>

          <ScrollView 
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {restrictions.length > 0 ? (
              <View style={styles.restrictionsSection}>
                {restrictions.map((r, idx) => {
                  const bannerStyle = getBannerStyle(r.type);
                  return (
                    <View 
                      key={idx} 
                      style={[
                        styles.restrictionBanner,
                        { 
                          backgroundColor: bannerStyle.bg,
                          borderLeftColor: bannerStyle.border,
                        }
                      ]}
                    >
                      <View style={styles.bannerHeader}>
                        <Feather 
                          name={getBannerIcon(r.type, r.icon)} 
                          size={18} 
                          color={bannerStyle.icon} 
                        />
                        <ThemedText 
                          type="body" 
                          style={[styles.bannerTitle, { color: bannerStyle.icon }]}
                        >
                          {r.title}
                        </ThemedText>
                      </View>
                      <ThemedText type="small" style={{ color: theme.textSecondary }}>
                        {r.message}
                      </ThemedText>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View style={[styles.summaryCard, { backgroundColor: theme.backgroundDefault }]}>
              <ThemedText type="caption" style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                Transaction Summary
              </ThemedText>

              <View style={styles.summaryRow}>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Sending
                </ThemedText>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  {amount} {tokenSymbol}
                </ThemedText>
              </View>

              <View style={styles.summaryRow}>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  To
                </ThemedText>
                <ThemedText type="small" style={{ fontFamily: "monospace" }}>
                  {shortenAddress(recipient)}
                </ThemedText>
              </View>

              <View style={styles.summaryRow}>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Network
                </ThemedText>
                <ThemedText type="small">
                  {network}
                </ThemedText>
              </View>

              <View style={styles.summaryRow}>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Fee
                </ThemedText>
                <ThemedText type="small">
                  {fee}
                </ThemedText>
              </View>
            </View>

            <View style={[styles.riskCard, { backgroundColor: getRiskColor(riskLevel) + "15" }]}>
              <View style={styles.riskHeader}>
                <Feather name={getRiskIcon(riskLevel)} size={20} color={getRiskColor(riskLevel)} />
                <ThemedText type="body" style={[styles.riskLabel, { color: getRiskColor(riskLevel) }]}>
                  {getRiskLabel(riskLevel)}
                </ThemedText>
              </View>

              {riskReasons.length > 0 ? (
                <View style={styles.riskReasons}>
                  {riskReasons.map((reason, idx) => (
                    <View key={idx} style={styles.reasonRow}>
                      <View style={[styles.reasonDot, { backgroundColor: getRiskColor(riskLevel) }]} />
                      <ThemedText type="small" style={{ color: theme.textSecondary, flex: 1 }}>
                        {reason}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </ScrollView>

          <View style={styles.buttons}>
            {isBlocked ? (
              <Button onPress={onClose} style={styles.singleButton}>
                OK
              </Button>
            ) : (
              <>
                <Pressable 
                  onPress={onClose} 
                  style={[styles.cancelButton, { borderColor: theme.border }]}
                >
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    Cancel
                  </ThemedText>
                </Pressable>
                <Button 
                  onPress={onConfirm}
                  disabled={isLoading}
                  style={[
                    styles.confirmButton,
                    (riskLevel === "high" || riskLevel === "scam") && { backgroundColor: theme.danger }
                  ]}
                >
                  {riskLevel === "high" || riskLevel === "scam" ? "I Understand, Send" : confirmText}
                </Button>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.lg,
    maxHeight: "85%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  shieldBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
  },
  title: {
    flex: 1,
  },
  closeButton: {
    padding: Spacing.xs,
  },
  subtitle: {
    marginBottom: Spacing.lg,
    marginLeft: 44,
  },
  scrollView: {
    flexGrow: 0,
  },
  scrollContent: {
    gap: Spacing.md,
    paddingBottom: Spacing.md,
  },
  restrictionsSection: {
    gap: Spacing.sm,
  },
  restrictionBanner: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 4,
    gap: Spacing.xs,
  },
  bannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  bannerTitle: {
    fontWeight: "700",
  },
  summaryCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  sectionLabel: {
    marginBottom: Spacing.xs,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontSize: 11,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  riskCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  riskHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  riskLabel: {
    fontWeight: "700",
  },
  riskReasons: {
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  reasonDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  buttons: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmButton: {
    flex: 1,
  },
  singleButton: {
    flex: 1,
  },
});

export function buildRestrictionBanners(restriction: TransferRestriction): RestrictionBanner[] {
  const banners: RestrictionBanner[] = [];

  if (restriction.restrictionType === "non_transferable") {
    banners.push({
      type: "danger",
      title: "Cannot Send - Non-Transferable Token",
      message: restriction.message,
      icon: "x-octagon",
    });
  } else if (restriction.restrictionType === "delegate_only" && restriction.isUserDelegate) {
    banners.push({
      type: "warning",
      title: "Non-Transferable Token (Delegate Only)",
      message: "You are the permanent delegate. Only you can transfer this token.",
      icon: "key",
    });
  } else if (restriction.restrictionType === "transfer_hook") {
    banners.push({
      type: "warning",
      title: "Transfer Restrictions Enabled",
      message: restriction.message,
      icon: "alert-triangle",
    });
  }

  if (restriction.delegateAddress && restriction.restrictionType !== "non_transferable" && restriction.restrictionType !== "delegate_only") {
    banners.push({
      type: "info",
      title: "Permanent Delegate",
      message: `This token has a permanent delegate: ${restriction.delegateAddress.slice(0, 4)}...${restriction.delegateAddress.slice(-4)}`,
      icon: "info",
    });
  }

  return banners;
}
