import React, { useState } from "react";
import {
  View,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { RiskLevel, SafetyCheck, TokenSafetyResult } from "@/hooks/useTokenSafetyScan";

interface TokenSafetyStripProps {
  result: TokenSafetyResult | null;
  isScanning: boolean;
  timeAgo: string;
  onRescan: () => void;
}

function getRiskBadgeConfig(riskLevel: RiskLevel): {
  label: string;
  color: string;
  bgColor: string;
  icon: React.ComponentProps<typeof Feather>["name"];
} {
  switch (riskLevel) {
    case "LOW":
      return {
        label: "Low",
        color: Colors.dark.success,
        bgColor: Colors.dark.success + "20",
        icon: "check-circle",
      };
    case "MEDIUM":
      return {
        label: "Medium",
        color: Colors.dark.warning,
        bgColor: Colors.dark.warning + "20",
        icon: "alert-triangle",
      };
    case "HIGH":
      return {
        label: "High",
        color: Colors.dark.danger,
        bgColor: Colors.dark.danger + "20",
        icon: "alert-octagon",
      };
    case "NEEDS_DEEPER_SCAN":
      return {
        label: "Needs scan",
        color: "#8B92A8",
        bgColor: "rgba(139, 146, 168, 0.2)",
        icon: "help-circle",
      };
  }
}

function getCheckIcon(status: SafetyCheck["status"]): {
  name: React.ComponentProps<typeof Feather>["name"];
  color: string;
} {
  switch (status) {
    case "safe":
      return { name: "check-circle", color: Colors.dark.success };
    case "warning":
      return { name: "alert-triangle", color: Colors.dark.warning };
    case "info":
      return { name: "info", color: "#8B92A8" };
    case "unknown":
      return { name: "help-circle", color: "#8B92A8" };
  }
}

export function TokenSafetyStrip({
  result,
  isScanning,
  timeAgo,
  onRescan,
}: TokenSafetyStripProps) {
  const { theme } = useTheme();
  const [showDetails, setShowDetails] = useState(false);

  if (!result && !isScanning) {
    return null;
  }

  const badge = result ? getRiskBadgeConfig(result.riskLevel) : null;

  return (
    <>
      <Pressable
        style={({ pressed }) => [
          styles.strip,
          {
            backgroundColor: theme.glass,
            borderColor: theme.glassBorder,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
        onPress={() => result && setShowDetails(true)}
      >
        <View style={styles.stripLeft}>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Safety
          </ThemedText>
          {isScanning ? (
            <View style={styles.scanningRow}>
              <ActivityIndicator size="small" color={theme.accent} />
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginLeft: Spacing.xs }}>
                Scanning...
              </ThemedText>
            </View>
          ) : badge ? (
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: badge.bgColor }]}>
                <Feather name={badge.icon} size={12} color={badge.color} />
                <ThemedText
                  type="caption"
                  style={{ color: badge.color, fontWeight: "600", marginLeft: 4 }}
                >
                  {badge.label}
                </ThemedText>
              </View>
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginLeft: Spacing.sm }}>
                Scanned by Cordon • {timeAgo}
              </ThemedText>
            </View>
          ) : null}
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.rescanButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
          onPress={(e) => {
            e.stopPropagation();
            onRescan();
          }}
          hitSlop={8}
        >
          <Feather name="refresh-cw" size={14} color={theme.accent} />
        </Pressable>
      </Pressable>

      <Modal
        visible={showDetails}
        animationType="slide"
        transparent
        onRequestClose={() => setShowDetails(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowDetails(false)} />
          <View style={[styles.modalContent, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <ThemedText type="h3">Token Safety</ThemedText>
              <Pressable onPress={() => setShowDetails(false)} hitSlop={12}>
                <Feather name="x" size={24} color={theme.text} />
              </Pressable>
            </View>

            {result && badge ? (
              <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                <View style={[styles.overallBadge, { backgroundColor: badge.bgColor }]}>
                  <Feather name={badge.icon} size={20} color={badge.color} />
                  <ThemedText style={{ color: badge.color, fontWeight: "700", fontSize: 18, marginLeft: Spacing.sm }}>
                    {badge.label} Risk
                  </ThemedText>
                </View>

                <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
                  Scanned by Cordon • {timeAgo}
                </ThemedText>

                {result.checks.map((check) => {
                  const icon = getCheckIcon(check.status);
                  return (
                    <View
                      key={check.id}
                      style={[styles.checkRow, { borderColor: theme.glassBorder }]}
                    >
                      <Feather name={icon.name} size={18} color={icon.color} />
                      <View style={styles.checkText}>
                        <ThemedText type="body" style={{ fontWeight: "600" }}>
                          {check.title}
                        </ThemedText>
                        <ThemedText type="small" style={{ color: theme.textSecondary }}>
                          {check.longText}
                        </ThemedText>
                      </View>
                    </View>
                  );
                })}

                <ThemedText
                  type="caption"
                  style={{ color: theme.textSecondary, marginTop: Spacing.xl, textAlign: "center" }}
                >
                  Verified = on-chain facts. Not financial advice.
                </ThemedText>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  stripLeft: {
    flex: 1,
  },
  scanningRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 2,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  rescanButton: {
    padding: Spacing.xs,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalContent: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing["3xl"],
    height: "75%",
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  modalScroll: {
    flex: 1,
  },
  overallBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  checkText: {
    flex: 1,
    marginLeft: Spacing.md,
  },
});
