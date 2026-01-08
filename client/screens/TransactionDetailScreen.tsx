import { View, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useState } from "react";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "TransactionDetail">;

export default function TransactionDetailScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { txHash } = route.params;
  const [copied, setCopied] = useState(false);

  const mockTx = {
    hash: "0xabc123def456789...123",
    type: "send",
    status: "success",
    amount: "-0.5 ETH",
    amountUsd: "$890.50",
    from: "0x1234...5678",
    to: "0x8765...4321",
    network: "Ethereum",
    gasUsed: "21,000",
    gasFee: "0.002 ETH",
    gasFeeUsd: "$3.56",
    timestamp: "Jan 8, 2026, 2:30 PM",
    blockNumber: "18,234,567",
  };

  const handleCopyHash = async () => {
    await Clipboard.setStringAsync(mockTx.hash);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleViewExplorer = () => {
    Linking.openURL(`https://etherscan.io/tx/${mockTx.hash}`);
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
        <View style={[styles.statusCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[styles.statusIcon, { backgroundColor: theme.success + "20" }]}>
            <Feather name="check-circle" size={32} color={theme.success} />
          </View>
          <ThemedText type="h3">Transaction Successful</ThemedText>
          <Badge label="Confirmed" variant="success" />
        </View>

        <View style={[styles.amountCard, { backgroundColor: theme.backgroundDefault }]}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Amount
          </ThemedText>
          <ThemedText type="h1" style={styles.amount}>
            {mockTx.amount}
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {mockTx.amountUsd}
          </ThemedText>
        </View>

        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Details
          </ThemedText>
          
          <View style={[styles.detailsCard, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.detailRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                From
              </ThemedText>
              <ThemedText type="body" style={styles.detailValue}>
                {mockTx.from}
              </ThemedText>
            </View>
            
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            
            <View style={styles.detailRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                To
              </ThemedText>
              <ThemedText type="body" style={styles.detailValue}>
                {mockTx.to}
              </ThemedText>
            </View>
            
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            
            <View style={styles.detailRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Network
              </ThemedText>
              <ThemedText type="body" style={styles.detailValue}>
                {mockTx.network}
              </ThemedText>
            </View>
            
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            
            <View style={styles.detailRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Gas Fee
              </ThemedText>
              <View style={styles.detailValueCol}>
                <ThemedText type="body" style={styles.detailValue}>
                  {mockTx.gasFee}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {mockTx.gasFeeUsd}
                </ThemedText>
              </View>
            </View>
            
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            
            <View style={styles.detailRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Block
              </ThemedText>
              <ThemedText type="body" style={styles.detailValue}>
                {mockTx.blockNumber}
              </ThemedText>
            </View>
            
            <View style={[styles.divider, { backgroundColor: theme.border }]} />
            
            <View style={styles.detailRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Time
              </ThemedText>
              <ThemedText type="body" style={styles.detailValue}>
                {mockTx.timestamp}
              </ThemedText>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Transaction Hash
          </ThemedText>
          <Pressable 
            style={[styles.hashCard, { backgroundColor: theme.backgroundDefault }]}
            onPress={handleCopyHash}
          >
            <ThemedText type="body" style={styles.hashText} numberOfLines={1}>
              {mockTx.hash}
            </ThemedText>
            <Feather name={copied ? "check" : "copy"} size={18} color={theme.accent} />
          </Pressable>
        </View>

        <Button onPress={handleViewExplorer} style={styles.explorerButton}>
          View on Explorer
        </Button>
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
  statusCard: {
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  statusIcon: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  amountCard: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  amount: {
    marginVertical: Spacing.sm,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  detailsCard: {
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: Spacing.sm,
  },
  detailValue: {
    fontWeight: "500",
    textAlign: "right",
    flex: 1,
    marginLeft: Spacing.lg,
  },
  detailValueCol: {
    alignItems: "flex-end",
  },
  divider: {
    height: 1,
  },
  hashCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  hashText: {
    flex: 1,
    fontFamily: "monospace",
    fontSize: 13,
  },
  explorerButton: {
    marginTop: Spacing.md,
  },
});
