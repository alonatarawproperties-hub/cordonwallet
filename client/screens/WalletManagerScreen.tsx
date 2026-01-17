import { useState } from "react";
import { View, StyleSheet, FlatList, Pressable, Alert, Modal, TextInput, KeyboardAvoidingView, Platform } from "react-native";
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
  const { wallets, activeWallet, setActiveWallet, removeWallet, renameWallet } = useWallet();
  
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameWalletId, setRenameWalletId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const handleCopyAddress = async (address: string) => {
    await Clipboard.setStringAsync(address);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const openRenameModal = (walletId: string, currentName: string) => {
    setRenameWalletId(walletId);
    setRenameValue(currentName);
    setRenameModalVisible(true);
  };

  const handleSaveRename = async () => {
    if (renameWalletId && renameValue.trim()) {
      await renameWallet(renameWalletId, renameValue.trim());
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setRenameModalVisible(false);
    setRenameWalletId(null);
    setRenameValue("");
  };

  const handleCancelRename = () => {
    setRenameModalVisible(false);
    setRenameWalletId(null);
    setRenameValue("");
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
    const walletType = (item as any).walletType || "multi-chain";
    const isSolanaOnly = walletType === "solana-only";

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
            <Feather 
              name={isSolanaOnly ? "sun" : "layers"} 
              size={20} 
              color={isActive ? theme.accent : theme.textSecondary} 
            />
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
              {isSolanaOnly ? (
                <View style={[styles.typeBadge, { backgroundColor: "#9945FF20" }]}>
                  <ThemedText style={{ color: "#9945FF", fontSize: 10, fontWeight: "600" }}>
                    SOL
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <View style={styles.addressesContainer}>
              {!isSolanaOnly ? (
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
              ) : null}
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
          {!isSolanaOnly ? (
            <>
              <Pressable 
                style={styles.actionButton}
                onPress={() => handleCopyAddress(evmAddress)}
              >
                <Feather name="copy" size={16} color={theme.accent} />
                <ThemedText type="small" style={{ color: theme.accent }}>Copy EVM</ThemedText>
              </Pressable>
              <View style={[styles.actionDivider, { backgroundColor: theme.border }]} />
            </>
          ) : null}
          {solanaAddress ? (
            <>
              <Pressable 
                style={styles.actionButton}
                onPress={() => handleCopyAddress(solanaAddress)}
              >
                <Feather name="copy" size={16} color="#9945FF" />
                <ThemedText type="small" style={{ color: "#9945FF" }}>Copy SOL</ThemedText>
              </Pressable>
              <View style={[styles.actionDivider, { backgroundColor: theme.border }]} />
            </>
          ) : null}
          <Pressable 
            style={styles.actionButton}
            onPress={() => openRenameModal(item.id, item.name)}
          >
            <Feather name="edit-2" size={16} color={theme.textSecondary} />
            <ThemedText type="small" style={{ color: theme.textSecondary }}>Rename</ThemedText>
          </Pressable>
          <View style={[styles.actionDivider, { backgroundColor: theme.border }]} />
          <Pressable 
            style={styles.actionButton}
            onPress={() => navigation.navigate("ExportWallet", { walletId: item.id, walletName: item.name })}
          >
            <Feather name="shield" size={16} color={theme.warning} />
            <ThemedText type="small" style={{ color: theme.warning }}>Backup</ThemedText>
          </Pressable>
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
      
      <Modal
        visible={renameModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCancelRename}
      >
        <KeyboardAvoidingView 
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={[styles.modalContent, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="h4" style={{ marginBottom: Spacing.md }}>
              Rename Wallet
            </ThemedText>
            <TextInput
              style={[
                styles.renameInput,
                { 
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                  color: theme.text,
                }
              ]}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Enter wallet name"
              placeholderTextColor={theme.textSecondary}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.modalButtons}>
              <Pressable
                style={[styles.modalButton, { backgroundColor: theme.backgroundSecondary }]}
                onPress={handleCancelRename}
              >
                <ThemedText type="body" style={{ color: theme.textSecondary }}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.modalButton, { backgroundColor: theme.accent }]}
                onPress={handleSaveRename}
              >
                <ThemedText type="body" style={{ color: "#FFFFFF", fontWeight: "600" }}>Save</ThemedText>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  typeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  modalContent: {
    width: "100%",
    maxWidth: 340,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
  },
  renameInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: 16,
    marginBottom: Spacing.lg,
  },
  modalButtons: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  modalButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});
