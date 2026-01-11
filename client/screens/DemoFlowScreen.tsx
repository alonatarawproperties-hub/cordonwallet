import React, { useState, useRef, useCallback } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { captureRef } from "react-native-view-shot";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { Spacing, BorderRadius } from "@/constants/theme";
import {
  DEMO_DAPP,
  DEMO_SIGN_MESSAGE,
  DEMO_SOLANA_TRANSACTION,
  DEMO_APPROVALS,
  DEMO_SUCCESS_TX,
  DEMO_STEPS,
  DemoStep,
} from "@/lib/demo/data";

export default function DemoFlowScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const [currentStep, setCurrentStep] = useState<DemoStep>("connect");
  const [isCapturing, setIsCapturing] = useState(false);
  const viewRefs = useRef<{ [key in DemoStep]?: View | null }>({});

  const handleExportAll = useCallback(async () => {
    setIsCapturing(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    
    try {
      const savedFilePaths: string[] = [];
      const demoDir = `${FileSystem.cacheDirectory}demo_assets/`;
      
      await FileSystem.makeDirectoryAsync(demoDir, { intermediates: true }).catch(() => {});
      
      for (const step of DEMO_STEPS) {
        setCurrentStep(step.key);
        await new Promise(resolve => setTimeout(resolve, 600));
        
        const viewRef = viewRefs.current[step.key];
        if (viewRef) {
          try {
            const uri = await captureRef(viewRef, {
              format: "png",
              quality: 1,
              result: "tmpfile",
            });
            
            const filename = `${String(DEMO_STEPS.indexOf(step) + 1).padStart(2, "0")}_${step.key}.png`;
            const destPath = `${demoDir}${filename}`;
            
            await FileSystem.moveAsync({ from: uri, to: destPath });
            savedFilePaths.push(destPath);
            console.log(`Saved: ${filename}`);
          } catch (err) {
            console.error(`Failed to capture ${step.key}:`, err);
          }
        }
      }
      
      if (savedFilePaths.length > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        
        const sharingAvailable = await Sharing.isAvailableAsync();
        if (sharingAvailable) {
          Alert.alert(
            "Export Complete",
            `Captured ${savedFilePaths.length} screenshots. Share them one at a time?`,
            [
              { text: "Skip", style: "cancel" },
              {
                text: "Share First",
                onPress: async () => {
                  try {
                    await Sharing.shareAsync(savedFilePaths[0], {
                      mimeType: "image/png",
                      dialogTitle: "Save Demo Screenshot",
                    });
                  } catch (e) {
                    console.log("Share cancelled or failed:", e);
                  }
                },
              },
            ]
          );
        } else {
          Alert.alert(
            "Export Complete",
            `Captured ${savedFilePaths.length} screenshots to:\n${demoDir}\n\nSharing not available on this platform. Screenshots saved to cache.`,
            [{ text: "OK" }]
          );
        }
      }
    } catch (error) {
      console.error("Export failed:", error);
      Alert.alert("Export Failed", "Could not capture screenshots. Please try again.");
    }
    
    setIsCapturing(false);
  }, []);

  const renderStepContent = () => {
    switch (currentStep) {
      case "connect":
        return <DemoConnectSheet theme={theme} />;
      case "sign_message":
        return <DemoSignMessageSheet theme={theme} />;
      case "sign_tx_low_risk":
        return <DemoSignTxSheet theme={theme} />;
      case "approvals":
        return <DemoApprovalsScreen theme={theme} />;
      case "revoke":
        return <DemoRevokeSheet theme={theme} />;
      case "success":
        return <DemoSuccessScreen theme={theme} />;
      default:
        return null;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + Spacing.lg,
          paddingBottom: insets.bottom + Spacing.lg,
          paddingHorizontal: Spacing.lg,
        }}
      >
        <ThemedText type="h2" style={{ marginBottom: Spacing.sm }}>
          Demo Flow Preview
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.lg }}>
          Preview all 6 demo steps for the website
        </ThemedText>

        <View style={styles.stepSelector}>
          {DEMO_STEPS.map((step, idx) => (
            <Pressable
              key={step.key}
              onPress={() => setCurrentStep(step.key)}
              style={[
                styles.stepTab,
                {
                  backgroundColor: currentStep === step.key ? theme.accent : theme.backgroundDefault,
                },
              ]}
            >
              <ThemedText
                type="small"
                style={{
                  color: currentStep === step.key ? "#fff" : theme.textSecondary,
                  fontWeight: "600",
                }}
              >
                {idx + 1}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <View style={[styles.stepInfo, { backgroundColor: theme.backgroundDefault }]}>
          <ThemedText type="body" style={{ fontWeight: "600" }}>
            {DEMO_STEPS.find(s => s.key === currentStep)?.title}
          </ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {DEMO_STEPS.find(s => s.key === currentStep)?.description}
          </ThemedText>
        </View>

        <View
          ref={(ref) => { viewRefs.current[currentStep] = ref; }}
          collapsable={false}
          style={[styles.previewContainer, { backgroundColor: theme.backgroundRoot }]}
        >
          {renderStepContent()}
        </View>

        <Button
          onPress={handleExportAll}
          disabled={isCapturing}
          style={{ marginTop: Spacing.lg }}
        >
          {isCapturing ? "Capturing Screenshots..." : "Export All Screenshots"}
        </Button>

        <ThemedText
          type="caption"
          style={{ color: theme.textSecondary, textAlign: "center", marginTop: Spacing.md }}
        >
          Screenshots will be saved to your photo library
        </ThemedText>
      </ScrollView>
    </View>
  );
}

function DemoConnectSheet({ theme }: { theme: any }) {
  return (
    <ThemedView style={styles.sheetPreview}>
      <View style={styles.sheetHandle} />
      <View style={styles.sheetHeader}>
        <ThemedText type="h3">Connect to dApp</ThemedText>
        <Feather name="x" size={24} color={theme.textSecondary} />
      </View>

      <View style={styles.dappInfo}>
        <View style={[styles.dappIcon, { backgroundColor: theme.accent + "20" }]}>
          <Feather name="globe" size={32} color={theme.accent} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: Spacing.md }}>
          <ThemedText type="h3">{DEMO_DAPP.name}</ThemedText>
          <View style={{ marginLeft: Spacing.sm }}>
            <Badge label="Verified" variant="success" />
          </View>
        </View>
        <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: Spacing.xs }}>
          {DEMO_DAPP.domain}
        </ThemedText>
      </View>

      <View style={[styles.infoCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.infoRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>Domain</ThemedText>
          <ThemedText type="body" style={{ fontWeight: "500" }}>{DEMO_DAPP.domain}</ThemedText>
        </View>
        <View style={[styles.infoRow, { marginTop: Spacing.sm }]}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>Networks</ThemedText>
          <ThemedText type="body" style={{ fontWeight: "500" }}>Ethereum, Solana</ThemedText>
        </View>
      </View>

      <View style={[styles.permissionsCard, { backgroundColor: theme.backgroundDefault }]}>
        <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
          This dApp will be able to:
        </ThemedText>
        {["View your wallet address", "Request transaction signatures", "Request message signatures"].map((perm, i) => (
          <View key={i} style={styles.permissionItem}>
            <Feather name="check" size={16} color={theme.success} />
            <ThemedText type="small" style={{ marginLeft: Spacing.sm }}>{perm}</ThemedText>
          </View>
        ))}
      </View>

      <View style={[styles.firewallCard, { backgroundColor: theme.accent + "15" }]}>
        <Feather name="shield" size={20} color={theme.accent} />
        <View style={{ flex: 1, marginLeft: Spacing.sm }}>
          <ThemedText type="small" style={{ fontWeight: "600" }}>Wallet Firewall Active</ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 2 }}>
            All transactions will be screened before signing.
          </ThemedText>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <View style={[styles.secondaryBtn, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <ThemedText type="body" style={{ fontWeight: "600" }}>Reject</ThemedText>
        </View>
        <View style={[styles.primaryBtn, { backgroundColor: theme.accent }]}>
          <ThemedText type="body" style={{ fontWeight: "600", color: "#fff" }}>Connect</ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

function DemoSignMessageSheet({ theme }: { theme: any }) {
  return (
    <ThemedView style={styles.sheetPreview}>
      <View style={styles.sheetHandle} />
      <View style={styles.sheetHeader}>
        <ThemedText type="h3">Sign Message</ThemedText>
        <Feather name="x" size={24} color={theme.textSecondary} />
      </View>

      <View style={styles.dappRow}>
        <View style={[styles.smallDappIcon, { backgroundColor: theme.accent + "20" }]}>
          <Feather name="globe" size={20} color={theme.accent} />
        </View>
        <View style={{ flex: 1, marginLeft: Spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>{DEMO_DAPP.name}</ThemedText>
            <View style={{ marginLeft: Spacing.xs }}>
              <Badge label="Verified" variant="success" />
            </View>
          </View>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>{DEMO_DAPP.domain}</ThemedText>
        </View>
        <Badge label="Solana" variant="neutral" />
      </View>

      <View style={[styles.summaryCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.summaryHeader}>
          <ThemedText type="body" style={{ fontWeight: "600" }}>What you're signing</ThemedText>
          <Badge label="Low Risk" variant="success" />
        </View>
        <View style={[styles.purposeRow, { backgroundColor: theme.backgroundSecondary }]}>
          <Feather name="check-circle" size={18} color={theme.success} />
          <ThemedText type="body" style={{ marginLeft: Spacing.sm, flex: 1 }}>
            Sign-in / authentication request
          </ThemedText>
        </View>
        <View style={[styles.impactRow, { backgroundColor: theme.accent + "10" }]}>
          <Feather name="shield" size={16} color={theme.accent} />
          <ThemedText type="small" style={{ marginLeft: Spacing.sm, flex: 1, color: theme.textSecondary }}>
            This does NOT move funds, and does NOT grant token approvals.
          </ThemedText>
        </View>
      </View>

      <View style={[styles.rawMessageCard, { backgroundColor: theme.backgroundDefault }]}>
        <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
          Raw message:
        </ThemedText>
        <ScrollView style={{ maxHeight: 120 }}>
          <ThemedText type="small" style={{ fontFamily: "monospace", lineHeight: 18 }}>
            {DEMO_SIGN_MESSAGE}
          </ThemedText>
        </ScrollView>
      </View>

      <View style={styles.buttonRow}>
        <View style={[styles.secondaryBtn, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <ThemedText type="body" style={{ fontWeight: "600" }}>Reject</ThemedText>
        </View>
        <View style={[styles.primaryBtn, { backgroundColor: theme.accent }]}>
          <ThemedText type="body" style={{ fontWeight: "600", color: "#fff" }}>Sign</ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

function DemoSignTxSheet({ theme }: { theme: any }) {
  return (
    <ThemedView style={styles.sheetPreview}>
      <View style={styles.sheetHandle} />
      <View style={styles.sheetHeader}>
        <ThemedText type="h3">Sign Transaction</ThemedText>
        <Feather name="x" size={24} color={theme.textSecondary} />
      </View>

      <View style={styles.dappRow}>
        <View style={[styles.smallDappIcon, { backgroundColor: theme.accent + "20" }]}>
          <Feather name="globe" size={20} color={theme.accent} />
        </View>
        <View style={{ flex: 1, marginLeft: Spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>{DEMO_DAPP.name}</ThemedText>
            <View style={{ marginLeft: Spacing.xs }}>
              <Badge label="Verified" variant="success" />
            </View>
          </View>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>{DEMO_DAPP.domain}</ThemedText>
        </View>
        <Badge label="Solana" variant="neutral" />
      </View>

      <View style={[styles.infoCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>Requested by</ThemedText>
          <ThemedText type="body" style={{ fontWeight: "500" }}>{DEMO_DAPP.name}</ThemedText>
        </View>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>Type</ThemedText>
          <Badge label="SPL Transfer" variant="neutral" />
        </View>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>Amount</ThemedText>
          <ThemedText type="body" style={{ fontWeight: "500" }}>100 USDC</ThemedText>
        </View>
      </View>

      <View style={[styles.riskCard, { backgroundColor: theme.success + "15", borderColor: theme.success }]}>
        <Feather name="check-circle" size={18} color={theme.success} />
        <View style={{ flex: 1, marginLeft: Spacing.sm }}>
          <ThemedText type="small" style={{ fontWeight: "600", color: theme.success }}>
            Low Risk
          </ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 2 }}>
            {DEMO_SOLANA_TRANSACTION.riskReason}
          </ThemedText>
        </View>
      </View>

      <View style={styles.buttonRow}>
        <View style={[styles.secondaryBtn, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <ThemedText type="body" style={{ fontWeight: "600" }}>Reject</ThemedText>
        </View>
        <View style={[styles.primaryBtn, { backgroundColor: theme.accent }]}>
          <ThemedText type="body" style={{ fontWeight: "600", color: "#fff" }}>Sign</ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

function DemoApprovalsScreen({ theme }: { theme: any }) {
  return (
    <ThemedView style={styles.fullScreenPreview}>
      <View style={[styles.screenHeader, { borderBottomColor: theme.border }]}>
        <ThemedText type="h3">Security</ThemedText>
      </View>

      <View style={styles.tabBar}>
        <View style={[styles.activeTab, { borderBottomColor: theme.accent }]}>
          <ThemedText type="body" style={{ color: theme.accent, fontWeight: "600" }}>EVM Approvals</ThemedText>
        </View>
        <View style={styles.inactiveTab}>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>Solana</ThemedText>
        </View>
      </View>

      {DEMO_APPROVALS.map((approval, idx) => (
        <View key={idx} style={[styles.approvalRow, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[styles.tokenIcon, { backgroundColor: theme.accent + "20" }]}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>{approval.tokenSymbol[0]}</ThemedText>
          </View>
          <View style={{ flex: 1, marginLeft: Spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <ThemedText type="body" style={{ fontWeight: "500" }}>{approval.tokenSymbol}</ThemedText>
              {approval.isUnlimited ? (
                <View style={{ marginLeft: Spacing.xs }}>
                  <Badge label="Unlimited" variant="danger" />
                </View>
              ) : null}
            </View>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              {approval.spenderLabel}
            </ThemedText>
          </View>
          <View style={[styles.revokeBtn, { backgroundColor: theme.danger + "15" }]}>
            <ThemedText type="small" style={{ color: theme.danger, fontWeight: "600" }}>Revoke</ThemedText>
          </View>
        </View>
      ))}
    </ThemedView>
  );
}

function DemoRevokeSheet({ theme }: { theme: any }) {
  return (
    <ThemedView style={styles.sheetPreview}>
      <View style={styles.sheetHandle} />
      <View style={styles.sheetHeader}>
        <ThemedText type="h3">Revoke Approval</ThemedText>
        <Feather name="x" size={24} color={theme.textSecondary} />
      </View>

      <View style={[styles.revokeInfo, { backgroundColor: theme.danger + "10" }]}>
        <Feather name="shield-off" size={48} color={theme.danger} />
        <ThemedText type="h3" style={{ marginTop: Spacing.md }}>Revoke USDC Approval</ThemedText>
        <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: Spacing.xs, textAlign: "center" }}>
          This will remove Uniswap V3 Router's access to spend your USDC tokens.
        </ThemedText>
      </View>

      <View style={[styles.infoCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>Token</ThemedText>
          <ThemedText type="body" style={{ fontWeight: "500" }}>USDC</ThemedText>
        </View>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>Spender</ThemedText>
          <ThemedText type="body" style={{ fontWeight: "500" }}>Uniswap V3 Router</ThemedText>
        </View>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>Current Allowance</ThemedText>
          <Badge label="Unlimited" variant="danger" />
        </View>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>New Allowance</ThemedText>
          <ThemedText type="body" style={{ fontWeight: "500", color: theme.success }}>0</ThemedText>
        </View>
      </View>

      <View style={[styles.warningCard, { backgroundColor: theme.warning + "15" }]}>
        <Feather name="info" size={16} color={theme.warning} />
        <ThemedText type="small" style={{ marginLeft: Spacing.sm, flex: 1, color: theme.textSecondary }}>
          A small gas fee will be required to submit this transaction.
        </ThemedText>
      </View>

      <View style={styles.buttonRow}>
        <View style={[styles.secondaryBtn, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <ThemedText type="body" style={{ fontWeight: "600" }}>Cancel</ThemedText>
        </View>
        <View style={[styles.primaryBtn, { backgroundColor: theme.danger }]}>
          <ThemedText type="body" style={{ fontWeight: "600", color: "#fff" }}>Revoke</ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

function DemoSuccessScreen({ theme }: { theme: any }) {
  return (
    <ThemedView style={styles.fullScreenPreview}>
      <View style={styles.successContent}>
        <View style={[styles.successIcon, { backgroundColor: theme.success + "20" }]}>
          <Feather name="check-circle" size={64} color={theme.success} />
        </View>
        <ThemedText type="h2" style={{ marginTop: Spacing.xl }}>Revoked Successfully</ThemedText>
        <ThemedText type="body" style={{ color: theme.textSecondary, marginTop: Spacing.sm, textAlign: "center" }}>
          USDC approval for Uniswap V3 Router has been revoked.
        </ThemedText>

        <View style={[styles.txDetails, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>Transaction</ThemedText>
            <ThemedText type="small" style={{ fontFamily: "monospace" }}>
              {DEMO_SUCCESS_TX.hash.slice(0, 10)}...{DEMO_SUCCESS_TX.hash.slice(-8)}
            </ThemedText>
          </View>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>Status</ThemedText>
            <Badge label="Confirmed" variant="success" />
          </View>
        </View>

        <View style={[styles.fullWidthBtn, { backgroundColor: theme.accent }]}>
          <ThemedText type="body" style={{ fontWeight: "600", color: "#fff" }}>Done</ThemedText>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  stepSelector: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  stepTab: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  stepInfo: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  previewContainer: {
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    minHeight: 400,
  },
  sheetPreview: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.lg,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(128,128,128,0.4)",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: Spacing.md,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  dappInfo: {
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  dappIcon: {
    width: 72,
    height: 72,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  smallDappIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  dappRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  infoCard: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  txRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
  permissionsCard: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  permissionItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  firewallCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: 12,
    marginBottom: Spacing.lg,
  },
  buttonRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  secondaryBtn: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryCard: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  summaryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  purposeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    borderRadius: 8,
    marginBottom: Spacing.sm,
  },
  impactRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    borderRadius: 8,
  },
  rawMessageCard: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  riskCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  fullScreenPreview: {
    padding: Spacing.lg,
    minHeight: 400,
  },
  screenHeader: {
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    marginBottom: Spacing.md,
  },
  tabBar: {
    flexDirection: "row",
    marginBottom: Spacing.lg,
  },
  activeTab: {
    flex: 1,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 2,
    alignItems: "center",
  },
  inactiveTab: {
    flex: 1,
    paddingBottom: Spacing.sm,
    alignItems: "center",
  },
  approvalRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: 12,
    marginBottom: Spacing.sm,
  },
  tokenIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  revokeBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 8,
  },
  revokeInfo: {
    alignItems: "center",
    padding: Spacing.xl,
    borderRadius: 16,
    marginBottom: Spacing.lg,
  },
  warningCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: 12,
    marginBottom: Spacing.md,
  },
  successContent: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing["2xl"],
  },
  successIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  txDetails: {
    width: "100%",
    borderRadius: 12,
    padding: Spacing.md,
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  fullWidthBtn: {
    width: "100%",
    padding: Spacing.md,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
