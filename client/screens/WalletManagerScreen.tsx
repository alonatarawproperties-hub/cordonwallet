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

  const showWalletMenu = (walletId: string, walletName: string) => {
    Alert.alert(
      walletName,
      undefined,
      [
        {
          text: "Rename",
          onPress: () => openRenameModal(walletId, walletName),
        },
        {
          text: "Backup Seed Phrase",
          onPress: () => navigation.navigate("ExportWallet", { walletId, walletName }),
        },
        {
          text: "Remove Wallet",
          style: "destructive",
          onPress: () => handleRemoveWallet(walletId, walletName),
        },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

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
            borderColor: isActive ? theme.accent : "transparent",
          }
        ]}
        onPress={() => setActiveWallet(item as any)}
      >
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
                <ThemedText style={{ color: "#FFFFFF", fontSize: 9, fontWeight: "700" }}>
                  ACTIVE
                </ThemedText>
              </View>
            ) : null}
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {isSolanaOnly ? truncate(solanaAddress || "") : `${truncate(evmAddress)} · ${truncate(solanaAddress || "")}`}
          </ThemedText>
        </View>

        <Pressable 
          style={styles.menuButton}
          onPress={() => showWalletMenu(item.id, item.name)}
          hitSlop={12}
        >
          <Feather name="more-vertical" size={20} color={theme.textSecondary} />
        </Pressable>
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
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    padding: Spacing.md,
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
    gap: 2,
  },
  walletNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  activeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  menuButton: {
    padding: Spacing.xs,
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
