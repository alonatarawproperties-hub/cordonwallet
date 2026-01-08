import { useState } from "react";
import { View, StyleSheet, ScrollView, Switch, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Input } from "@/components/Input";
import { Badge } from "@/components/Badge";
import { useWallet } from "@/lib/wallet-context";

export default function PolicySettingsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { policySettings, updatePolicySettings } = useWallet();
  
  const [blockUnlimited, setBlockUnlimited] = useState(policySettings.blockUnlimitedApprovals);
  const [maxSpend, setMaxSpend] = useState(policySettings.maxSpendPerTransaction);
  const [dailyLimit, setDailyLimit] = useState(policySettings.dailySpendLimit);

  const handleSave = async () => {
    await updatePolicySettings({
      blockUnlimitedApprovals: blockUnlimited,
      maxSpendPerTransaction: maxSpend,
      dailySpendLimit: dailyLimit,
    });
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing["2xl"] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.infoCard, { backgroundColor: theme.accent + "15" }]}>
          <View style={[styles.infoIcon, { backgroundColor: theme.accent + "30" }]}>
            <Feather name="shield" size={24} color={theme.accent} />
          </View>
          <View style={styles.infoContent}>
            <ThemedText type="h4" style={{ color: theme.accent }}>
              Wallet Firewall
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.accent }}>
              Configure policies to protect your assets from risky transactions
            </ThemedText>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Approval Controls
          </ThemedText>
          
          <View style={[styles.settingRow, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.settingInfo}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                Block Unlimited Approvals
              </ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Prevent signing unlimited token approvals
              </ThemedText>
            </View>
            <Switch
              value={blockUnlimited}
              onValueChange={(value) => {
                setBlockUnlimited(value);
                handleSave();
              }}
              trackColor={{ false: theme.border, true: theme.accent }}
            />
          </View>

          <View style={[styles.warningCard, { backgroundColor: theme.warning + "15", borderColor: theme.warning + "40" }]}>
            <Feather name="alert-triangle" size={16} color={theme.warning} />
            <ThemedText type="caption" style={{ color: theme.warning, flex: 1 }}>
              Unlimited approvals allow contracts to spend all your tokens. We recommend keeping this blocked.
            </ThemedText>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Spending Limits
          </ThemedText>

          <View style={[styles.inputCard, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.inputHeader}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                Max Per Transaction
              </ThemedText>
              <Badge label="USD" variant="neutral" />
            </View>
            <Input
              value={maxSpend}
              onChangeText={setMaxSpend}
              placeholder="1000"
              keyboardType="numeric"
            />
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Transactions above this amount will require extra confirmation
            </ThemedText>
          </View>

          <View style={[styles.inputCard, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.inputHeader}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                Daily Spending Limit
              </ThemedText>
              <Badge label="USD" variant="neutral" />
            </View>
            <Input
              value={dailyLimit}
              onChangeText={setDailyLimit}
              placeholder="5000"
              keyboardType="numeric"
            />
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Total daily spending across all transactions
            </ThemedText>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Address Lists
          </ThemedText>

          <Pressable style={[styles.listRow, { backgroundColor: theme.backgroundDefault }]}>
            <View style={[styles.listIcon, { backgroundColor: theme.success + "20" }]}>
              <Feather name="check-circle" size={20} color={theme.success} />
            </View>
            <View style={styles.listInfo}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                Allowlist
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Trusted addresses that skip extra checks
              </ThemedText>
            </View>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              0 addresses
            </ThemedText>
            <Feather name="chevron-right" size={20} color={theme.textSecondary} />
          </Pressable>

          <Pressable style={[styles.listRow, { backgroundColor: theme.backgroundDefault }]}>
            <View style={[styles.listIcon, { backgroundColor: theme.danger + "20" }]}>
              <Feather name="x-circle" size={20} color={theme.danger} />
            </View>
            <View style={styles.listInfo}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                Denylist
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                Blocked addresses that cannot receive funds
              </ThemedText>
            </View>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              0 addresses
            </ThemedText>
            <Feather name="chevron-right" size={20} color={theme.textSecondary} />
          </Pressable>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
    marginBottom: Spacing["2xl"],
  },
  infoIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  infoContent: {
    flex: 1,
    gap: Spacing.xs,
  },
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionTitle: {
    marginBottom: Spacing.lg,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  settingInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  inputCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  inputHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  listIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  listInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
});
