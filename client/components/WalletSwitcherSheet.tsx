import React, { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Platform,
  ActionSheetIOS,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { useWallet } from "@/lib/wallet-context";
import type { Wallet } from "@/lib/types";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function WalletSwitcherSheet({ visible, onClose }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Navigation>();
  const { wallets, activeWallet, setActiveWallet } = useWallet();
  const [addMenuVisible, setAddMenuVisible] = useState(false);

  const handleSelectWallet = useCallback(async (wallet: Wallet) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await setActiveWallet(wallet);
    onClose();
  }, [setActiveWallet, onClose]);

  const handleCreateWallet = useCallback(() => {
    setAddMenuVisible(false);
    onClose();
    setTimeout(() => navigation.navigate("CreateWallet"), 0);
  }, [navigation, onClose]);

  const handleImportWallet = useCallback(() => {
    setAddMenuVisible(false);
    onClose();
    setTimeout(() => navigation.navigate("ImportWallet"), 0);
  }, [navigation, onClose]);

  const handleAddWallet = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Create New Wallet", "Import Wallet", "Cancel"],
          cancelButtonIndex: 2,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) {
            handleCreateWallet();
          } else if (buttonIndex === 1) {
            handleImportWallet();
          }
        }
      );
    } else {
      setAddMenuVisible(true);
    }
  }, [handleCreateWallet, handleImportWallet]);

  const handleManageWallets = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
    navigation.navigate("WalletManager");
  }, [navigation, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <ThemedView style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <ThemedText type="h3">Select Wallet</ThemedText>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContent}>
            {wallets.map((wallet) => {
              const isActive = wallet.id === activeWallet?.id;
              const evmAddress = wallet.addresses?.evm || wallet.address;
              const solanaAddress = wallet.addresses?.solana;

              return (
                <Pressable
                  key={wallet.id}
                  onPress={() => handleSelectWallet(wallet)}
                  style={[
                    styles.walletItem,
                    { 
                      backgroundColor: isActive ? theme.accent + "15" : theme.backgroundDefault,
                      borderColor: isActive ? theme.accent : theme.border,
                    }
                  ]}
                >
                  <View style={[styles.walletIcon, { backgroundColor: theme.accent + "20" }]}>
                    <Feather name="credit-card" size={20} color={theme.accent} />
                  </View>
                  <View style={styles.walletInfo}>
                    <View style={styles.walletNameRow}>
                      <ThemedText type="body" style={{ fontWeight: "600" }}>
                        {wallet.name}
                      </ThemedText>
                      {isActive ? (
                        <View style={[styles.activeBadge, { backgroundColor: theme.accent }]}>
                          <Feather name="check" size={12} color="#fff" />
                        </View>
                      ) : null}
                    </View>
                    <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 2 }}>
                      {evmAddress && solanaAddress 
                        ? "Multi-chain wallet" 
                        : solanaAddress 
                          ? "Solana wallet" 
                          : "EVM wallet"}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            })}

            {wallets.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="inbox" size={48} color={theme.textSecondary} />
                <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: Spacing.md }}>
                  No wallets found
                </ThemedText>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.buttons}>
            <Pressable
              onPress={handleAddWallet}
              style={[styles.addButton, { backgroundColor: theme.accent + "15", borderColor: theme.accent }]}
            >
              <View style={styles.buttonContent}>
                <Feather name="plus" size={18} color={theme.accent} />
                <ThemedText type="body" style={{ marginLeft: Spacing.xs, fontWeight: "500", color: theme.accent }}>
                  Add Wallet
                </ThemedText>
              </View>
            </Pressable>
            <Pressable
              onPress={handleManageWallets}
              style={[styles.manageButton, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}
            >
              <Feather name="settings" size={18} color={theme.textSecondary} />
              <ThemedText type="small" style={{ marginLeft: Spacing.xs, color: theme.textSecondary }}>
                Manage
              </ThemedText>
            </Pressable>
          </View>
        </ThemedView>
      </View>

      <Modal visible={addMenuVisible} transparent animationType="fade" onRequestClose={() => setAddMenuVisible(false)}>
        <View style={styles.menuOverlay}>
          <Pressable style={styles.menuBackdrop} onPress={() => setAddMenuVisible(false)} />
          <View style={[styles.menuCard, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="body" style={{ fontWeight: "600", marginBottom: Spacing.lg, textAlign: "center" }}>
              Add Wallet
            </ThemedText>
            <Pressable
              onPress={handleCreateWallet}
              style={[styles.menuOption, { backgroundColor: theme.accent + "15", borderColor: theme.accent }]}
            >
              <Feather name="plus-circle" size={20} color={theme.accent} />
              <ThemedText type="body" style={{ marginLeft: Spacing.md, color: theme.accent, fontWeight: "500" }}>
                Create New Wallet
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={handleImportWallet}
              style={[styles.menuOption, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}
            >
              <Feather name="download" size={20} color={theme.text} />
              <ThemedText type="body" style={{ marginLeft: Spacing.md, fontWeight: "500" }}>
                Import Wallet
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => setAddMenuVisible(false)}
              style={[styles.menuCancel, { borderColor: theme.border }]}
            >
              <ThemedText type="body" style={{ color: theme.textSecondary }}>
                Cancel
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.lg,
    maxHeight: "70%",
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(128,128,128,0.4)",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  scrollContent: {
    flexGrow: 0,
  },
  walletItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  walletIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  walletInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  walletNameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  activeBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: Spacing.sm,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
  },
  buttons: {
    flexDirection: "row",
    marginTop: Spacing.lg,
  },
  addButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: Spacing.sm,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  manageButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
  },
  menuOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  menuCard: {
    width: "85%",
    borderRadius: 16,
    padding: Spacing.lg,
  },
  menuOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  menuCancel: {
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: Spacing.xs,
  },
});
