import React from "react";
import { View, StyleSheet, Modal, Pressable, ScrollView } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { RiskLevel, getRiskColor, getRiskIcon } from "@/lib/token-security-ui";
import type { TokenSecurityAssessment, SecurityCheck } from "@/lib/token-security";

interface TokenSecurityModalProps {
  visible: boolean;
  onClose: () => void;
  assessment: TokenSecurityAssessment | null;
  tokenName?: string;
  tokenSymbol?: string;
}

function RiskBadge({ risk, label }: { risk: RiskLevel; label: string }) {
  const color = getRiskColor(risk);
  const iconName = getRiskIcon(risk) as keyof typeof Feather.glyphMap;
  
  return (
    <View style={[styles.riskBadge, { backgroundColor: color + "20" }]}>
      <Feather name={iconName} size={20} color={color} />
      <ThemedText type="h4" style={{ color, marginLeft: 8 }}>
        {label}
      </ThemedText>
    </View>
  );
}

function SecurityCheckRow({ check }: { check: SecurityCheck }) {
  const { theme } = useTheme();
  const color = check.detected ? getRiskColor(check.riskLevel) : theme.textSecondary;
  const iconName = check.detected 
    ? (getRiskIcon(check.riskLevel) as keyof typeof Feather.glyphMap)
    : "check";

  return (
    <View style={[styles.checkRow, { borderBottomColor: theme.border }]}>
      <View style={styles.checkHeader}>
        <View style={[styles.checkIcon, { backgroundColor: color + "20" }]}>
          <Feather name={iconName} size={14} color={color} />
        </View>
        <ThemedText type="h4" style={styles.checkName}>
          {check.name}
        </ThemedText>
        {check.detected && check.riskLevel !== "safe" ? (
          <View style={[styles.statusPill, { backgroundColor: color + "20" }]}>
            <ThemedText type="caption" style={{ color }}>
              {check.riskLevel === "risky" ? "High Risk" : "Caution"}
            </ThemedText>
          </View>
        ) : null}
      </View>
      <ThemedText type="body" style={[styles.checkExplanation, { color: theme.textSecondary }]}>
        {check.explanation}
      </ThemedText>
    </View>
  );
}

export function TokenSecurityModal({
  visible,
  onClose,
  assessment,
  tokenName,
  tokenSymbol,
}: TokenSecurityModalProps) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  if (!assessment) return null;

  const riskLabel = assessment.overallRisk === "safe" 
    ? "Low Risk" 
    : assessment.overallRisk === "caution" 
      ? "Medium Risk" 
      : "High Risk";

  const detectedChecks = assessment.checks.filter(c => c.detected);
  const riskyChecks = detectedChecks.filter(c => c.riskLevel === "risky");
  const cautionChecks = detectedChecks.filter(c => c.riskLevel === "caution");
  const safeChecks = detectedChecks.filter(c => c.riskLevel === "safe");

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <BlurView 
        intensity={isDark ? 40 : 60} 
        tint={isDark ? "dark" : "light"}
        style={StyleSheet.absoluteFill}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
      </BlurView>
      
      <View style={[styles.container, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={[styles.sheet, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.handle} />
          
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <ThemedText type="h3">Security Assessment</ThemedText>
              {tokenSymbol ? (
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
                  {tokenName || tokenSymbol} ({tokenSymbol})
                </ThemedText>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={24} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView 
            style={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.summarySection}>
              <RiskBadge risk={assessment.overallRisk} label={riskLabel} />
              
              {assessment.isToken2022 ? (
                <View style={[styles.token2022Badge, { backgroundColor: theme.accent + "20" }]}>
                  <ThemedText type="caption" style={{ color: theme.accent }}>
                    Token-2022
                  </ThemedText>
                </View>
              ) : null}
              
              <ThemedText 
                type="body" 
                style={[styles.summaryText, { color: theme.textSecondary }]}
              >
                {assessment.summary}
              </ThemedText>
            </View>

            {riskyChecks.length > 0 ? (
              <View style={styles.section}>
                <ThemedText type="h4" style={[styles.sectionTitle, { color: getRiskColor("risky") }]}>
                  High Risk Items
                </ThemedText>
                {riskyChecks.map((check, i) => (
                  <SecurityCheckRow key={`risky-${i}`} check={check} />
                ))}
              </View>
            ) : null}

            {cautionChecks.length > 0 ? (
              <View style={styles.section}>
                <ThemedText type="h4" style={[styles.sectionTitle, { color: getRiskColor("caution") }]}>
                  Items to Review
                </ThemedText>
                {cautionChecks.map((check, i) => (
                  <SecurityCheckRow key={`caution-${i}`} check={check} />
                ))}
              </View>
            ) : null}

            {safeChecks.length > 0 ? (
              <View style={styles.section}>
                <ThemedText type="h4" style={[styles.sectionTitle, { color: getRiskColor("safe") }]}>
                  Safe Features
                </ThemedText>
                {safeChecks.map((check, i) => (
                  <SecurityCheckRow key={`safe-${i}`} check={check} />
                ))}
              </View>
            ) : null}

            <View style={[styles.disclaimer, { backgroundColor: theme.backgroundSecondary }]}>
              <Feather name="info" size={14} color={theme.textSecondary} />
              <ThemedText type="caption" style={[styles.disclaimerText, { color: theme.textSecondary }]}>
                This assessment is automated and may not catch all risks. Always research tokens before transacting.
              </ThemedText>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  container: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    height: "60%",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#888",
    alignSelf: "center",
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: Spacing.lg,
  },
  headerLeft: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  summarySection: {
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  riskBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    marginBottom: Spacing.sm,
  },
  token2022Badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
  },
  summaryText: {
    textAlign: "center",
    lineHeight: 22,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    marginBottom: Spacing.sm,
  },
  checkRow: {
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  checkHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  checkIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.sm,
  },
  checkName: {
    flex: 1,
  },
  statusPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  checkExplanation: {
    marginLeft: 32,
    lineHeight: 20,
  },
  disclaimer: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  disclaimerText: {
    flex: 1,
    lineHeight: 18,
  },
});
