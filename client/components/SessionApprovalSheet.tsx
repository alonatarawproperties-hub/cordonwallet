import React, { useCallback } from "react";
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { SUPPORTED_CHAINS, SUPPORTED_METHODS } from "@/lib/walletconnect/client";

interface Props {
  visible: boolean;
  proposal: {
    id: number;
    params: {
      proposer: {
        metadata: {
          name: string;
          description: string;
          url: string;
          icons: string[];
        };
      };
      requiredNamespaces?: Record<string, { chains?: string[]; methods?: string[]; events?: string[] }>;
      optionalNamespaces?: Record<string, { chains?: string[]; methods?: string[]; events?: string[] }>;
    };
  } | null;
  isApproving: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export function SessionApprovalSheet({
  visible,
  proposal,
  isApproving,
  onApprove,
  onReject,
}: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const handleApprove = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onApprove();
  }, [onApprove]);

  const handleReject = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onReject();
  }, [onReject]);

  if (!proposal) return null;

  const { metadata } = proposal.params.proposer;
  const supportedChainNames = Object.values(SUPPORTED_CHAINS).map((c) => {
    switch (c.chainId) {
      case 1:
        return "Ethereum";
      case 137:
        return "Polygon";
      case 56:
        return "BNB Chain";
      default:
        return `Chain ${c.chainId}`;
    }
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={isApproving ? undefined : handleReject}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={isApproving ? undefined : handleReject} />

        <ThemedView style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <ThemedText type="h3">Connect to dApp</ThemedText>
            <Pressable onPress={handleReject} hitSlop={12}>
              <Feather name="x" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContent}>
            <View style={styles.dappInfo}>
              <View style={[styles.dappIcon, { backgroundColor: theme.accent + "20" }]}>
                <Feather name="globe" size={32} color={theme.accent} />
              </View>
              <ThemedText type="h3" style={{ marginTop: Spacing.md }}>
                {metadata.name}
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: Spacing.xs }}>
                {metadata.url.replace(/^https?:\/\//, "")}
              </ThemedText>
            </View>

            <View style={[styles.infoCard, { backgroundColor: theme.backgroundDefault }]}>
              <View style={styles.infoRow}>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  Networks
                </ThemedText>
                <ThemedText type="body" style={{ fontWeight: "500" }}>
                  {supportedChainNames.join(", ")}
                </ThemedText>
              </View>
            </View>

            <View style={[styles.permissionsCard, { backgroundColor: theme.backgroundDefault }]}>
              <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
                This dApp will be able to:
              </ThemedText>
              <View style={styles.permissionItem}>
                <Feather name="check" size={16} color={theme.success} />
                <ThemedText type="small" style={{ marginLeft: Spacing.sm }}>
                  View your wallet address
                </ThemedText>
              </View>
              <View style={styles.permissionItem}>
                <Feather name="check" size={16} color={theme.success} />
                <ThemedText type="small" style={{ marginLeft: Spacing.sm }}>
                  Request transaction signatures
                </ThemedText>
              </View>
              <View style={styles.permissionItem}>
                <Feather name="check" size={16} color={theme.success} />
                <ThemedText type="small" style={{ marginLeft: Spacing.sm }}>
                  Request message signatures
                </ThemedText>
              </View>
            </View>

            <View style={[styles.warningCard, { backgroundColor: theme.accent + "15" }]}>
              <Feather name="shield" size={20} color={theme.accent} />
              <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                <ThemedText type="small" style={{ fontWeight: "600" }}>
                  Wallet Firewall Active
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 2 }}>
                  All transactions will be screened before signing.
                </ThemedText>
              </View>
            </View>
          </ScrollView>

          <View style={styles.buttons}>
            <Pressable
              onPress={handleReject}
              disabled={isApproving}
              style={[
                styles.secondaryButton,
                { backgroundColor: theme.backgroundDefault, borderColor: theme.border, flex: 1, marginRight: Spacing.sm }
              ]}
            >
              <ThemedText type="body" style={{ fontWeight: "600" }}>Reject</ThemedText>
            </Pressable>
            <Button
              onPress={handleApprove}
              style={{ flex: 1, marginLeft: Spacing.sm }}
              disabled={isApproving}
            >
              {isApproving ? "Connecting..." : "Connect"}
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
    backgroundColor: "rgba(0,0,0,0.5)",
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
  dappInfo: {
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  dappIcon: {
    width: 72,
    height: 72,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  infoCard: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  permissionsCard: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  permissionItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: 12,
    marginBottom: Spacing.lg,
  },
  buttons: {
    flexDirection: "row",
    marginTop: Spacing.md,
  },
  secondaryButton: {
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
