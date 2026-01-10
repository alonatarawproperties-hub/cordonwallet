import { View, StyleSheet, ScrollView, Pressable, Share, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { HeaderButton } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useLayoutEffect, useState } from "react";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { getChainById } from "@/lib/blockchain/chains";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "TransactionDetail">;

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (date.toDateString() === now.toDateString()) {
    return `Today at ${timeStr}`;
  } else if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${timeStr}`;
  } else {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) + ` at ${timeStr}`;
  }
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export default function TransactionDetailScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const [copied, setCopied] = useState(false);
  
  const {
    hash,
    chainId,
    activityType,
    tokenSymbol,
    amount,
    to,
    from,
    status,
    createdAt,
    explorerUrl,
  } = route.params;

  const chain = chainId === 0 ? { name: "Solana", id: 0 } : getChainById(chainId);
  const isReceive = activityType === "receive";
  const isSwap = activityType === "swap";
  
  const getTitle = () => {
    if (isReceive) return `Receive ${tokenSymbol}`;
    if (isSwap) return `Swap ${tokenSymbol}`;
    return `Send ${tokenSymbol}`;
  };

  const getAmountDisplay = () => {
    if (isReceive) return `+${amount} ${tokenSymbol}`;
    if (isSwap) return `${amount} ${tokenSymbol}`;
    return `-${amount} ${tokenSymbol}`;
  };

  const amountColor = isReceive ? theme.success : theme.text;

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Transaction ${hash}\n${explorerUrl}`,
        url: explorerUrl,
      });
    } catch (error) {
      console.error("Failed to share:", error);
    }
  };

  const handleCopyAddress = async (address: string) => {
    await Clipboard.setStringAsync(address);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleViewExplorer = async () => {
    await WebBrowser.openBrowserAsync(explorerUrl);
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: getTitle(),
      headerRight: () => (
        <HeaderButton onPress={handleShare}>
          <Feather name="share" size={20} color={theme.text} />
        </HeaderButton>
      ),
    });
  }, [navigation, theme, tokenSymbol, activityType]);

  const getStatusLabel = () => {
    switch (status) {
      case "confirmed":
        return "Completed";
      case "pending":
        return "Pending";
      case "failed":
        return "Failed";
    }
  };

  const getCounterpartyLabel = () => {
    if (isReceive) return "Sender";
    return "Recipient";
  };

  const getCounterpartyAddress = () => {
    if (isReceive && from) return from;
    return to;
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
        <View style={styles.amountSection}>
          <ThemedText
            type="h1"
            style={[styles.amountText, { color: amountColor }]}
          >
            {getAmountDisplay()}
          </ThemedText>
        </View>

        <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.row}>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              Date
            </ThemedText>
            <ThemedText type="body" style={styles.rowValue}>
              {formatDate(createdAt)}
            </ThemedText>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <View style={styles.row}>
            <View style={styles.rowLabelWithIcon}>
              <ThemedText type="body" style={{ color: theme.textSecondary }}>
                Status
              </ThemedText>
              <Pressable>
                <Feather name="info" size={14} color={theme.textSecondary} />
              </Pressable>
            </View>
            <ThemedText 
              type="body" 
              style={[
                styles.rowValue, 
                { color: status === "confirmed" ? theme.text : status === "pending" ? theme.warning : theme.danger }
              ]}
            >
              {getStatusLabel()}
            </ThemedText>
          </View>

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <Pressable 
            style={styles.row}
            onPress={() => handleCopyAddress(getCounterpartyAddress())}
          >
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              {getCounterpartyLabel()}
            </ThemedText>
            <View style={styles.addressRow}>
              <ThemedText type="body" style={styles.rowValue}>
                {truncateAddress(getCounterpartyAddress())}
              </ThemedText>
              <Feather 
                name={copied ? "check" : "copy"} 
                size={14} 
                color={copied ? theme.success : theme.textSecondary} 
              />
            </View>
          </Pressable>
        </View>

        <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.row}>
            <View style={styles.rowLabelWithIcon}>
              <ThemedText type="body" style={{ color: theme.textSecondary }}>
                Network
              </ThemedText>
              <Pressable>
                <Feather name="info" size={14} color={theme.textSecondary} />
              </Pressable>
            </View>
            <ThemedText type="body" style={styles.rowValue}>
              {chain?.name || "Unknown"}
            </ThemedText>
          </View>
        </View>

        <Pressable style={styles.explorerLink} onPress={handleViewExplorer}>
          <ThemedText type="body" style={{ color: theme.accent }}>
            View on block explorer
          </ThemedText>
        </Pressable>
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
  amountSection: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  amountText: {
    fontSize: 36,
    fontWeight: "700",
  },
  card: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  rowLabelWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  rowValue: {
    fontWeight: "500",
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  divider: {
    height: 1,
    marginVertical: Spacing.xs,
  },
  explorerLink: {
    alignItems: "center",
    paddingVertical: Spacing.lg,
  },
});
