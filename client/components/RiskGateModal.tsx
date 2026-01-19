import React, { useState } from "react";
import {
  View,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { RiskLevel, SafetyCheck, TokenSafetyResult } from "@/hooks/useTokenSafetyScan";

interface RiskGateModalProps {
  visible: boolean;
  result: TokenSafetyResult;
  onCancel: () => void;
  onProceed: () => void;
  onRescan: () => void;
}

function getRiskConfig(riskLevel: RiskLevel): {
  title: string;
  color: string;
  bgColor: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  requiresTwoStep: boolean;
} {
  switch (riskLevel) {
    case "HIGH":
      return {
        title: "High risk token",
        color: Colors.dark.danger,
        bgColor: Colors.dark.danger + "20",
        icon: "alert-octagon",
        requiresTwoStep: true,
      };
    case "MEDIUM":
      return {
        title: "Medium risk token",
        color: Colors.dark.warning,
        bgColor: Colors.dark.warning + "20",
        icon: "alert-triangle",
        requiresTwoStep: false,
      };
    case "NEEDS_DEEPER_SCAN":
      return {
        title: "Token needs deeper scan",
        color: "#8B92A8",
        bgColor: "rgba(139, 146, 168, 0.2)",
        icon: "help-circle",
        requiresTwoStep: false,
      };
    default:
      return {
        title: "Safety check",
        color: Colors.dark.success,
        bgColor: Colors.dark.success + "20",
        icon: "check-circle",
        requiresTwoStep: false,
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

export function RiskGateModal({
  visible,
  result,
  onCancel,
  onProceed,
  onRescan,
}: RiskGateModalProps) {
  const { theme } = useTheme();
  const [step, setStep] = useState<1 | 2>(1);
  const config = getRiskConfig(result.riskLevel);

  const handleProceed = () => {
    if (config.requiresTwoStep && step === 1) {
      setStep(2);
    } else {
      onProceed();
      setStep(1);
    }
  };

  const handleCancel = () => {
    setStep(1);
    onCancel();
  };

  const warningChecks = result.checks.filter(c => c.status === "warning" || c.status === "unknown");

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleCancel}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleCancel} />
        <View style={[styles.content, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.handle} />
          
          <View style={[styles.headerBadge, { backgroundColor: config.bgColor }]}>
            <Feather name={config.icon} size={24} color={config.color} />
            <ThemedText style={[styles.headerTitle, { color: config.color }]}>
              {config.title}
            </ThemedText>
          </View>

          {config.requiresTwoStep && step === 2 ? (
            <View style={[styles.confirmBox, { backgroundColor: Colors.dark.danger + "15" }]}>
              <Feather name="alert-triangle" size={20} color={Colors.dark.danger} />
              <ThemedText style={{ color: Colors.dark.danger, marginLeft: Spacing.sm, flex: 1 }}>
                Are you sure you want to continue? This token has high risk indicators.
              </ThemedText>
            </View>
          ) : (
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
                {result.riskLevel === "NEEDS_DEEPER_SCAN"
                  ? "Some checks could not be verified. You may proceed or try rescanning."
                  : "Review the following before proceeding:"}
              </ThemedText>

              {warningChecks.map((check) => {
                const icon = getCheckIcon(check.status);
                return (
                  <View key={check.id} style={[styles.checkRow, { borderColor: theme.glassBorder }]}>
                    <Feather name={icon.name} size={16} color={icon.color} />
                    <View style={styles.checkText}>
                      <ThemedText type="small" style={{ fontWeight: "600" }}>
                        {check.title}
                      </ThemedText>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                        {check.shortText}
                      </ThemedText>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.buttons}>
            {result.riskLevel === "NEEDS_DEEPER_SCAN" ? (
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { borderColor: theme.accent, opacity: pressed ? 0.8 : 1 },
                ]}
                onPress={onRescan}
              >
                <Feather name="refresh-cw" size={16} color={theme.accent} />
                <ThemedText style={{ color: theme.accent, fontWeight: "600", marginLeft: Spacing.xs }}>
                  Rescan
                </ThemedText>
              </Pressable>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: theme.glassBorder, opacity: pressed ? 0.8 : 1 },
              ]}
              onPress={handleCancel}
            >
              <ThemedText style={{ color: theme.text, fontWeight: "600" }}>
                Cancel
              </ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                { opacity: pressed ? 0.9 : 1 },
              ]}
              onPress={handleProceed}
            >
              <LinearGradient
                colors={
                  config.requiresTwoStep && step === 2
                    ? [Colors.dark.danger, "#DC2626"]
                    : [theme.accent, theme.accentSecondary]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryButtonGradient}
              >
                <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                  {config.requiresTwoStep
                    ? step === 1
                      ? "I understand the risks"
                      : "Continue anyway"
                    : "Proceed"}
                </ThemedText>
              </LinearGradient>
            </Pressable>
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
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  content: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing["3xl"],
    maxHeight: "70%",
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
  },
  headerBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.lg,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginLeft: Spacing.sm,
  },
  confirmBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.lg,
  },
  scroll: {
    flexGrow: 0,
    maxHeight: 200,
    marginBottom: Spacing.lg,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  checkText: {
    flex: 1,
    marginLeft: Spacing.sm,
  },
  buttons: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  primaryButton: {
    flex: 1,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  primaryButtonGradient: {
    paddingVertical: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
