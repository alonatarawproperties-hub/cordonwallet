import { useState, useEffect, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import {
  getSwapHistory,
  calculateSwapStats,
} from "@/services/swapStore";
import {
  JUPITER_API_URL,
  SPEED_CONFIGS,
  SwapSpeed,
  DEFAULT_SLIPPAGE_BPS,
  QUOTE_REFRESH_INTERVAL_MS,
  QUOTE_DEBOUNCE_MS,
} from "@/constants/solanaSwap";

interface SwapMetrics {
  totalSwaps: number;
  successfulSwaps: number;
  failedSwaps: number;
  averageConfirmationTime: number;
  totalFeesSpent: number;
}

export default function SwapDebugScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();

  const [metrics, setMetrics] = useState<SwapMetrics | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadMetrics = useCallback(async () => {
    const history = await getSwapHistory();
    const stats = calculateSwapStats(history);
    setMetrics({
      totalSwaps: stats.totalSwaps,
      successfulSwaps: stats.successfulSwaps,
      failedSwaps: stats.failedSwaps,
      averageConfirmationTime: stats.avgConfirmationMs,
      totalFeesSpent: history.reduce((acc, r) => acc + r.capSol, 0),
    });
  }, []);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadMetrics();
    setRefreshing(false);
  };

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const renderConfigSection = () => (
    <View style={[styles.section, { backgroundColor: theme.backgroundSecondary }]}>
      <ThemedText type="h4" style={{ marginBottom: Spacing.md }}>Configuration</ThemedText>
      
      <View style={styles.configRow}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>Jupiter API</ThemedText>
        <Pressable onPress={() => copyToClipboard(JUPITER_API_URL)}>
          <ThemedText type="small" numberOfLines={1} style={{ maxWidth: 200 }}>
            {JUPITER_API_URL}
          </ThemedText>
        </Pressable>
      </View>
      
      <View style={styles.configRow}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>Quote Refresh</ThemedText>
        <ThemedText type="small">{QUOTE_REFRESH_INTERVAL_MS}ms</ThemedText>
      </View>
      
      <View style={styles.configRow}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>Quote Debounce</ThemedText>
        <ThemedText type="small">{QUOTE_DEBOUNCE_MS}ms</ThemedText>
      </View>
      
      <View style={styles.configRow}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>Default Slippage</ThemedText>
        <ThemedText type="small">{DEFAULT_SLIPPAGE_BPS} bps (0.5%)</ThemedText>
      </View>
    </View>
  );

  const renderSpeedConfigs = () => (
    <View style={[styles.section, { backgroundColor: theme.backgroundSecondary }]}>
      <ThemedText type="h4" style={{ marginBottom: Spacing.md }}>Speed Configurations</ThemedText>
      
      {(Object.keys(SPEED_CONFIGS) as SwapSpeed[]).map((speed) => {
        const config = SPEED_CONFIGS[speed];
        return (
          <View key={speed} style={[styles.speedCard, { backgroundColor: theme.backgroundTertiary }]}>
            <View style={styles.speedHeader}>
              <ThemedText type="body" style={{ fontWeight: "600", textTransform: "capitalize" }}>
                {speed}
              </ThemedText>
              <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                <ThemedText type="caption" style={{ color: "#fff" }}>
                  {config.capSol} SOL
                </ThemedText>
              </View>
            </View>
            
            <View style={styles.speedDetails}>
              <View style={styles.speedDetailRow}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>Fee Cap</ThemedText>
                <ThemedText type="caption">{config.capSol} SOL</ThemedText>
              </View>
              <View style={styles.speedDetailRow}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>Rebroadcast</ThemedText>
                <ThemedText type="caption">{config.rebroadcastIntervalMs}ms</ThemedText>
              </View>
              <View style={styles.speedDetailRow}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>Max Duration</ThemedText>
                <ThemedText type="caption">{config.maxRebroadcastDurationMs / 1000}s</ThemedText>
              </View>
              <View style={styles.speedDetailRow}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>Completion</ThemedText>
                <ThemedText type="caption">{config.completionLevel}</ThemedText>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );

  const renderMetricsSection = () => {
    if (!metrics) return null;
    
    const successRate = metrics.totalSwaps > 0 
      ? ((metrics.successfulSwaps / metrics.totalSwaps) * 100).toFixed(1)
      : "0.0";
    
    return (
      <View style={[styles.section, { backgroundColor: theme.backgroundSecondary }]}>
        <ThemedText type="h4" style={{ marginBottom: Spacing.md }}>Session Metrics</ThemedText>
        
        <View style={styles.metricsGrid}>
          <View style={[styles.metricCard, { backgroundColor: theme.backgroundTertiary }]}>
            <ThemedText type="h2">{metrics.totalSwaps}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>Total Swaps</ThemedText>
          </View>
          
          <View style={[styles.metricCard, { backgroundColor: theme.backgroundTertiary }]}>
            <ThemedText type="h2" style={{ color: "#22C55E" }}>{metrics.successfulSwaps}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>Successful</ThemedText>
          </View>
          
          <View style={[styles.metricCard, { backgroundColor: theme.backgroundTertiary }]}>
            <ThemedText type="h2" style={{ color: "#EF4444" }}>{metrics.failedSwaps}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>Failed</ThemedText>
          </View>
          
          <View style={[styles.metricCard, { backgroundColor: theme.backgroundTertiary }]}>
            <ThemedText type="h2">{successRate}%</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>Success Rate</ThemedText>
          </View>
        </View>
        
        {metrics.averageConfirmationTime > 0 && (
          <View style={[styles.configRow, { marginTop: Spacing.md }]}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>Avg Confirmation</ThemedText>
            <ThemedText type="small">{(metrics.averageConfirmationTime / 1000).toFixed(1)}s</ThemedText>
          </View>
        )}
        
        {metrics.totalFeesSpent > 0 && (
          <View style={styles.configRow}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>Total Fees Spent</ThemedText>
            <ThemedText type="small">{metrics.totalFeesSpent.toFixed(6)} SOL</ThemedText>
          </View>
        )}
      </View>
    );
  };

  const renderSecuritySection = () => (
    <View style={[styles.section, { backgroundColor: theme.backgroundSecondary }]}>
      <ThemedText type="h4" style={{ marginBottom: Spacing.md }}>Security</ThemedText>
      
      <View style={styles.securityItem}>
        <Feather name="check-circle" size={16} color="#22C55E" />
        <ThemedText type="small" style={{ marginLeft: Spacing.sm }}>
          Jupiter program allowlist validation
        </ThemedText>
      </View>
      
      <View style={styles.securityItem}>
        <Feather name="check-circle" size={16} color="#22C55E" />
        <ThemedText type="small" style={{ marginLeft: Spacing.sm }}>
          Drainer instruction detection
        </ThemedText>
      </View>
      
      <View style={styles.securityItem}>
        <Feather name="check-circle" size={16} color="#22C55E" />
        <ThemedText type="small" style={{ marginLeft: Spacing.sm }}>
          Fee payer verification
        </ThemedText>
      </View>
      
      <View style={styles.securityItem}>
        <Feather name="check-circle" size={16} color="#22C55E" />
        <ThemedText type="small" style={{ marginLeft: Spacing.sm }}>
          Max slippage enforcement (5%)
        </ThemedText>
      </View>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} />
        }
      >
        {renderMetricsSection()}
        {renderConfigSection()}
        {renderSpeedConfigs()}
        {renderSecuritySection()}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  section: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
  },
  configRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  speedCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  speedHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  speedDetails: {
    gap: Spacing.xs,
  },
  speedDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  metricCard: {
    flex: 1,
    minWidth: "45%",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  securityItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
});
