import { View, StyleSheet, FlatList, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useWallet } from "@/lib/wallet-context";
import { deleteSeedPhrase } from "@/lib/secure-storage";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export default function WalletManagerScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { wallets, activeWallet, setActiveWallet, removeWallet } = useWallet();

  const handleCopyAddress = async (address: string) => {
    await Clipboard.setStringAsync(address);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleRemoveWallet = (walletId: string, walletName: string) => {
    Alert.alert(
      "Remove Wallet",
      `Are you sure you want to remove "${walletName}"? Make sure you have backed up the seed phrase.`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Remove", 
          style: "destructive",
          onPress: async () => {
            await deleteSeedPhrase(walletId);
            await removeWallet(walletId);
            if (wallets.length <= 1) {
              navigation.reset({
                index: 0,
                routes: [{ name: "Welcome" }],
              });
            }
          }
        },
      ]
    );
  };

  const truncate = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const renderWallet = ({ item }: { item: typeof wallets[0] }) => {
    const isActive = activeWallet?.id === item.id;
    const evmAddress = item.addresses?.evm || item.address;
    const solanaAddress = item.addresses?.solana;

    return (
      <Pressable
        style={[
          styles.walletCard,
          { 
            backgroundColor: theme.backgroundDefault,
            borderColor: isActive ? theme.accent : theme.border,
          }
        ]}
        onPress={() => setActiveWallet(item as any)}
      >
        <View style={styles.walletHeader}>
          <View style={[
            styles.walletIcon, 
            { backgroundColor: isActive ? theme.accent + "20" : theme.backgroundSecondary }
          ]}>
            <Feather name="credit-card" size={20} color={isActive ? theme.accent : theme.textSecondary} />
          </View>
          <View style={styles.walletInfo}>
            <View style={styles.walletNameRow}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {item.name}
              </ThemedText>
              {isActive ? (
                <View style={[styles.activeBadge, { backgroundColor: theme.accent }]}>
                  <ThemedText style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "700" }}>
                    ACTIVE
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <View style={styles.addressesContainer}>
              <Pressable 
                style={styles.addressRow}
                onPress={() => handleCopyAddress(evmAddress)}
              >
                <View style={[styles.chainIndicator, { backgroundColor: "#627EEA" }]} />
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {truncate(evmAddress)}
                </ThemedText>
                <Feather name="copy" size={10} color={theme.accent} />
              </Pressable>
              {solanaAddress ? (
                <Pressable 
                  style={styles.addressRow}
                  onPress={() => handleCopyAddress(solanaAddress)}
                >
                  <View style={[styles.chainIndicator, { backgroundColor: "#9945FF" }]} />
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {truncate(solanaAddress)}
                  </ThemedText>
                  <Feather name="copy" size={10} color={theme.accent} />
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        <View style={[styles.walletActions, { borderTopColor: theme.border }]}>
          <Pressable 
            style={styles.actionButton}
            onPress={() => handleCopyAddress(evmAddress)}
          >
            <Feather name="copy" size={16} color={theme.accent} />
            <ThemedText type="small" style={{ color: theme.accent }}>Copy EVM</ThemedText>
          </Pressable>
          {solanaAddress ? (
            <>
              <View style={[styles.actionDivider, { backgroundColor: theme.border }]} />
              <Pressable 
                style={styles.actionButton}
                onPress={() => handleCopyAddress(solanaAddress)}
              >
                <Feather name="copy" size={16} color="#9945FF" />
                <ThemedText type="small" style={{ color: "#9945FF" }}>Copy SOL</ThemedText>
              </Pressable>
            </>
          ) : null}
          <View style={[styles.actionDivider, { backgroundColor: theme.border }]} />
          <Pressable 
            style={styles.actionButton}
            onPress={() => handleRemoveWallet(item.id, item.name)}
          >
            <Feather name="trash-2" size={16} color={theme.danger} />
            <ThemedText type="small" style={{ color: theme.danger }}>Remove</ThemedText>
          </Pressable>
        </View>
      </Pressable>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <FlatList
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing["2xl"] },
        ]}
        data={wallets}
        keyExtractor={(item) => item.id}
        renderItem={renderWallet}
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              Manage your wallets. Tap a wallet to make it active.
            </ThemedText>
          </View>
        }
        ListEmptyComponent={
          <View style={[styles.emptyState, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="credit-card" size={48} color={theme.textSecondary} />
            <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>
              No wallets yet
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
              Create or import a wallet to get started
            </ThemedText>
          </View>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Button onPress={() => navigation.navigate("CreateWallet")}>
              Add New Wallet
            </Button>
            <Pressable 
              style={[styles.importButton, { borderColor: theme.border }]}
              onPress={() => navigation.navigate("ImportWallet")}
            >
              <Feather name="download" size={18} color={theme.text} />
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                Import Wallet
              </ThemedText>
            </Pressable>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
  },
  header: {
    marginBottom: Spacing.xl,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  walletCard: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  walletHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  walletIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  walletInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  walletNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  activeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  addressesContainer: {
    gap: 4,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  chainIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  walletActions: {
    flexDirection: "row",
    borderTopWidth: 1,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  actionDivider: {
    width: 1,
  },
  footer: {
    marginTop: Spacing["2xl"],
    gap: Spacing.md,
  },
  importButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    gap: Spacing.sm,
  },
});
