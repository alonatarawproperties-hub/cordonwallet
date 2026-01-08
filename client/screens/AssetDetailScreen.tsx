import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Badge } from "@/components/Badge";
import { useWallet } from "@/lib/wallet-context";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "AssetDetail">;
type Navigation = NativeStackNavigationProp<RootStackParamList>;

const MOCK_TXS = [
  { id: "1", type: "receive", amount: "+0.5 ETH", time: "2 hours ago" },
  { id: "2", type: "send", amount: "-0.1 ETH", time: "1 day ago" },
  { id: "3", type: "receive", amount: "+1.2 ETH", time: "3 days ago" },
];

export default function AssetDetailScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { tokenSymbol, balance } = route.params;
  const { activeWallet } = useWallet();

  const mockAsset = {
    symbol: tokenSymbol,
    name: tokenSymbol === "ETH" ? "Ethereum" : tokenSymbol === "USDC" ? "USD Coin" : "Polygon",
    balance: balance,
    balanceUsd: "$4,523.12",
    price: "$1,780.50",
    change: "+2.34%",
    changePositive: true,
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
        <View style={[styles.headerCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[styles.tokenIcon, { backgroundColor: theme.accent + "20" }]}>
            <ThemedText type="h2" style={{ color: theme.accent }}>
              {mockAsset.symbol.slice(0, 2)}
            </ThemedText>
          </View>
          <ThemedText type="h4">{mockAsset.name}</ThemedText>
          <ThemedText type="h1" style={styles.balance}>
            {mockAsset.balance} {mockAsset.symbol}
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            {mockAsset.balanceUsd}
          </ThemedText>
        </View>

        <View style={styles.priceCard}>
          <View style={[styles.priceRow, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="body">Price</ThemedText>
            <View style={styles.priceValue}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {mockAsset.price}
              </ThemedText>
              <Badge 
                label={mockAsset.change} 
                variant={mockAsset.changePositive ? "success" : "danger"} 
              />
            </View>
          </View>
        </View>

        <View style={styles.actionButtons}>
          <Pressable 
            style={[styles.actionButton, { backgroundColor: theme.backgroundDefault }]}
            onPress={() => navigation.navigate("Send", { tokenSymbol: mockAsset.symbol })}
          >
            <View style={[styles.actionIcon, { backgroundColor: theme.accent + "20" }]}>
              <Feather name="arrow-up-right" size={24} color={theme.accent} />
            </View>
            <ThemedText type="body" style={{ fontWeight: "600" }}>Send</ThemedText>
          </Pressable>

          <Pressable 
            style={[styles.actionButton, { backgroundColor: theme.backgroundDefault }]}
            onPress={() => navigation.navigate("Receive", { walletAddress: activeWallet?.address || "" })}
          >
            <View style={[styles.actionIcon, { backgroundColor: theme.success + "20" }]}>
              <Feather name="arrow-down-left" size={24} color={theme.success} />
            </View>
            <ThemedText type="body" style={{ fontWeight: "600" }}>Receive</ThemedText>
          </Pressable>

          <Pressable style={[styles.actionButton, { backgroundColor: theme.backgroundDefault }]}>
            <View style={[styles.actionIcon, { backgroundColor: theme.warning + "20" }]}>
              <Feather name="repeat" size={24} color={theme.warning} />
            </View>
            <ThemedText type="body" style={{ fontWeight: "600" }}>Swap</ThemedText>
          </Pressable>
        </View>

        <View style={styles.section}>
          <ThemedText type="h4" style={styles.sectionTitle}>
            Recent Transactions
          </ThemedText>
          {MOCK_TXS.map((tx) => (
            <Pressable
              key={tx.id}
              style={[styles.txRow, { backgroundColor: theme.backgroundDefault }]}
              onPress={() => navigation.navigate("TransactionDetail", { txHash: tx.id })}
            >
              <View style={[
                styles.txIcon, 
                { backgroundColor: tx.type === "receive" ? theme.success + "20" : theme.danger + "20" }
              ]}>
                <Feather 
                  name={tx.type === "receive" ? "arrow-down-left" : "arrow-up-right"} 
                  size={18} 
                  color={tx.type === "receive" ? theme.success : theme.danger} 
                />
              </View>
              <View style={styles.txInfo}>
                <ThemedText type="body" style={{ fontWeight: "600", textTransform: "capitalize" }}>
                  {tx.type}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {tx.time}
                </ThemedText>
              </View>
              <ThemedText 
                type="body" 
                style={{ 
                  fontWeight: "600",
                  color: tx.type === "receive" ? theme.success : theme.text,
                }}
              >
                {tx.amount}
              </ThemedText>
              <Feather name="chevron-right" size={18} color={theme.textSecondary} />
            </Pressable>
          ))}
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
  headerCard: {
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    marginBottom: Spacing.xl,
  },
  tokenIcon: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  balance: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  priceCard: {
    marginBottom: Spacing.xl,
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  priceValue: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  actionButtons: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  actionButton: {
    flex: 1,
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  txInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
});
