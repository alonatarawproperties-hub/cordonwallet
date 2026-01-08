import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/Badge";
import { useWallet } from "@/lib/wallet-context";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export default function BundlesScreen() {
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { wallets, bundles } = useWallet();

  const getWalletNamesForBundle = (walletIds: string[]) => {
    return walletIds
      .map(id => wallets.find(w => w.id === id)?.name || "Unknown")
      .join(", ");
  };

  const totalPortfolio = "$57,450.00";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.xl,
        paddingBottom: tabBarHeight + Spacing.xl,
        paddingHorizontal: Spacing.lg,
        flexGrow: 1,
      }}
      scrollIndicatorInsets={{ bottom: insets.bottom }}
    >
      <View style={[styles.summaryCard, { backgroundColor: theme.backgroundDefault }]}>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Total Portfolio
        </ThemedText>
        <ThemedText type="h1" style={styles.totalBalance}>
          {totalPortfolio}
        </ThemedText>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <ThemedText type="h3" style={{ color: theme.accent }}>
              {wallets.length}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Wallets
            </ThemedText>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.stat}>
            <ThemedText type="h3" style={{ color: theme.success }}>
              {bundles.length}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Bundles
            </ThemedText>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <ThemedText type="h4">My Bundles</ThemedText>
          <Pressable 
            style={[styles.addButton, { backgroundColor: theme.accent }]}
            onPress={() => navigation.navigate("CreateBundle")}
          >
            <Feather name="plus" size={16} color="#FFFFFF" />
            <ThemedText style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 14 }}>
              New
            </ThemedText>
          </Pressable>
        </View>

        {bundles.length > 0 ? (
          <View style={styles.bundleList}>
            {bundles.map((bundle) => (
              <Pressable
                key={bundle.id}
                style={[styles.bundleCard, { backgroundColor: theme.backgroundDefault }]}
                onPress={() => {}}
              >
                <View style={styles.bundleHeader}>
                  <View style={[styles.bundleIcon, { backgroundColor: theme.accent + "20" }]}>
                    <Feather name="layers" size={20} color={theme.accent} />
                  </View>
                  <View style={styles.bundleInfo}>
                    <ThemedText type="body" style={{ fontWeight: "600" }}>
                      {bundle.name}
                    </ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      {bundle.walletIds.length} wallet{bundle.walletIds.length !== 1 ? "s" : ""}
                    </ThemedText>
                  </View>
                  <Feather name="chevron-right" size={20} color={theme.textSecondary} />
                </View>
                <View style={[styles.bundleFooter, { borderTopColor: theme.border }]}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      Wallets
                    </ThemedText>
                    <ThemedText type="small" numberOfLines={1}>
                      {getWalletNamesForBundle(bundle.walletIds)}
                    </ThemedText>
                  </View>
                  <Badge label="Active" variant="success" />
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          <EmptyState
            title="No Bundles Yet"
            message="Create bundles to group your wallets and manage them together"
            actionLabel="Create Bundle"
            onAction={() => navigation.navigate("CreateBundle")}
          />
        )}
      </View>

      <View style={[styles.actionsCard, { backgroundColor: theme.backgroundDefault }]}>
        <ThemedText type="h4" style={styles.actionsTitle}>
          Batch Actions
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
          Perform operations across all wallets in a bundle
        </ThemedText>
        <View style={styles.actionButtons}>
          <Pressable style={[styles.actionButton, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={[styles.actionIcon, { backgroundColor: theme.accent + "20" }]}>
              <Feather name="send" size={20} color={theme.accent} />
            </View>
            <ThemedText type="small">Distribute Gas</ThemedText>
          </Pressable>
          <Pressable style={[styles.actionButton, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={[styles.actionIcon, { backgroundColor: theme.success + "20" }]}>
              <Feather name="dollar-sign" size={20} color={theme.success} />
            </View>
            <ThemedText type="small">Batch Send</ThemedText>
          </Pressable>
          <Pressable style={[styles.actionButton, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={[styles.actionIcon, { backgroundColor: theme.warning + "20" }]}>
              <Feather name="download" size={20} color={theme.warning} />
            </View>
            <ThemedText type="small">Collect All</ThemedText>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing["2xl"],
    alignItems: "center",
  },
  totalBalance: {
    marginVertical: Spacing.md,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing["2xl"],
  },
  stat: {
    alignItems: "center",
    gap: Spacing.xs,
  },
  divider: {
    width: 1,
    height: 32,
  },
  section: {
    marginBottom: Spacing["2xl"],
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    gap: Spacing.xs,
  },
  bundleList: {
    gap: Spacing.md,
  },
  bundleCard: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  bundleHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  bundleIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  bundleInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  bundleFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
  },
  actionsCard: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
  },
  actionsTitle: {
    marginBottom: Spacing.xs,
  },
  actionButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  actionButton: {
    flex: 1,
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});
