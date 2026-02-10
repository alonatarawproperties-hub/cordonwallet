import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import {
  PersonalSignRequest,
  SendTransactionRequest,
  SignTypedDataRequest,
  SolanaSignMessageRequest,
  SolanaSignTransactionRequest,
  SolanaSignAllTransactionsRequest,
  ParsedRequest,
  getChainName,
} from "@/lib/walletconnect/handlers";
import { getChainById } from "@/lib/blockchain/chains";
import { decodeSolanaTransaction, decodeSolanaTransactions, DecodedSolanaTransaction } from "@/lib/solana/decoder";
import { analyzeSignMessage, RiskLevel } from "@/lib/walletconnect/message-analyzer";

// Stubs for removed EVM approval modules (EVM disabled in Phase I)
function formatAllowance(amountRaw: string, decimals: number, symbol: string): string {
  return amountRaw;
}
function getSpenderLabel(chainId: number, spender: string): string | null {
  return null;
}

interface Props {
  visible: boolean;
  request: {
    request: {
      id: number;
      topic: string;
      params: {
        request: { method: string; params: unknown[] };
        chainId: string;
      };
    };
    parsed: ParsedRequest;
    isSolana: boolean;
  } | null;
  dappName: string;
  dappUrl: string;
  dappIcon?: string;
  isSigning: boolean;
  isApprovalBlocked: boolean;
  isDrainerBlocked?: boolean;
  onSign: () => void;
  onReject: () => void;
  onCapAllowance: () => void;
}

function extractDomain(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || "";
  }
}

function isValidDomain(domain: string): boolean {
  if (!domain) return false;
  // Basic domain validation - must have at least one dot and no spaces
  return domain.includes(".") && !domain.includes(" ") && domain.length > 3;
}

export function SignRequestSheet({
  visible,
  request,
  dappName,
  dappUrl,
  dappIcon,
  isSigning,
  isApprovalBlocked,
  isDrainerBlocked = false,
  onSign,
  onReject,
  onCapAllowance,
}: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  const handleSign = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSign();
  }, [onSign]);

  const handleReject = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onReject();
  }, [onReject]);

  const handleCapAllowance = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onCapAllowance();
  }, [onCapAllowance]);

  if (!request) return null;

  const { parsed, isSolana } = request;
  const isPersonalSign = parsed.method === "personal_sign";
  const isSendTx = parsed.method === "eth_sendTransaction";
  const isTypedData = parsed.method === "eth_signTypedData" || parsed.method === "eth_signTypedData_v4";
  const isSolanaSign = parsed.method.startsWith("solana_");

  const domain = extractDomain(dappUrl);
  const isDomainVerified = isValidDomain(domain);

  let chainName: string;
  if (isSolana || isSolanaSign) {
    chainName = "Solana";
  } else if (isSendTx) {
    const chainId = (parsed as SendTransactionRequest).chainId;
    const chain = getChainById(chainId);
    chainName = chain?.name || `Chain ${chainId}`;
  } else {
    chainName = "Ethereum";
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleReject}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleReject} />

        <ThemedView style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <ThemedText type="h3">
              {isPersonalSign || parsed.method === "solana_signMessage"
                ? "Sign Message"
                : isTypedData
                  ? "Sign Typed Data"
                  : isSolanaSign
                    ? "Sign Transaction"
                    : "Review Transaction"}
            </ThemedText>
            <Pressable onPress={handleReject} hitSlop={12}>
              <Feather name="x" size={24} color={theme.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContent}>
            <View style={styles.dappRow}>
              {dappIcon ? (
                <Image 
                  source={{ uri: dappIcon }} 
                  style={styles.dappIconImage}
                  defaultSource={require("../../assets/images/icon.png")}
                />
              ) : (
                <View style={[styles.dappIcon, { backgroundColor: theme.accent + "20" }]}>
                  <Feather name="globe" size={20} color={theme.accent} />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {dappName}
                  </ThemedText>
                  <View style={{ marginLeft: Spacing.xs }}>
                    <Badge 
                      label={isDomainVerified ? "Verified" : "Unverified"} 
                      variant={isDomainVerified ? "success" : "warning"} 
                    />
                  </View>
                </View>
                <ThemedText type="small" style={{ color: theme.textSecondary }}>
                  {domain || "Unknown domain"}
                </ThemedText>
              </View>
              <Badge label={chainName} variant="neutral" />
            </View>

            {!isDomainVerified && dappName !== "Unknown dApp" ? (
              <View style={[styles.unverifiedWarning, { backgroundColor: theme.warning + "15", borderColor: theme.warning }]}>
                <Feather name="alert-triangle" size={16} color={theme.warning} />
                <ThemedText type="small" style={{ color: theme.textSecondary, marginLeft: Spacing.sm, flex: 1 }}>
                  This dApp did not provide a verifiable domain. Proceed carefully.
                </ThemedText>
              </View>
            ) : null}

            {isPersonalSign ? (
              <PersonalSignContent 
                request={parsed as PersonalSignRequest} 
                dappDomain={domain}
                isDomainVerified={isDomainVerified}
              />
            ) : null}

            {isSendTx ? (
              <SendTransactionContent
                request={parsed as SendTransactionRequest}
                isApprovalBlocked={isApprovalBlocked}
              />
            ) : null}

            {isTypedData ? (
              <SignTypedDataContent
                request={parsed as SignTypedDataRequest}
                dappDomain={domain}
              />
            ) : null}

            {parsed.method === "solana_signMessage" ? (
              <SolanaSignMessageContent 
                request={parsed as SolanaSignMessageRequest} 
                dappDomain={domain}
                isDomainVerified={isDomainVerified}
              />
            ) : null}

            {parsed.method === "solana_signTransaction" ? (
              <SolanaTransactionContent 
                method={parsed.method} 
                transactionData={(parsed as SolanaSignTransactionRequest).transaction}
                dappName={dappName}
                dappDomain={dappUrl.replace(/^https?:\/\//, "")}
              />
            ) : null}

            {parsed.method === "solana_signAllTransactions" ? (
              <SolanaBatchTransactionContent 
                transactions={(parsed as SolanaSignAllTransactionsRequest).transactions || []}
                dappName={dappName}
                dappDomain={dappUrl.replace(/^https?:\/\//, "")}
              />
            ) : null}

            {isApprovalBlocked ? (
              <View style={[styles.blockedCard, { backgroundColor: theme.danger + "15", borderColor: theme.danger }]}>
                <Feather name="shield-off" size={20} color={theme.danger} />
                <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                  <ThemedText type="small" style={{ fontWeight: "600", color: theme.danger }}>
                    Unlimited Approval Blocked
                  </ThemedText>
                  <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 2 }}>
                    This transaction requests unlimited token spending. Set a cap to proceed safely.
                  </ThemedText>
                </View>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.buttons}>
            <Pressable
              onPress={handleReject}
              disabled={isSigning}
              style={[
                styles.secondaryButton,
                { backgroundColor: theme.backgroundDefault, borderColor: theme.border, flex: 1, marginRight: Spacing.sm }
              ]}
            >
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {isDrainerBlocked ? "Dismiss" : "Reject"}
              </ThemedText>
            </Pressable>
            {isDrainerBlocked ? (
              <View style={[styles.blockedButton, { backgroundColor: theme.danger + "30", flex: 1, marginLeft: Spacing.sm }]}>
                <Feather name="shield-off" size={18} color={theme.danger} />
                <ThemedText type="body" style={{ fontWeight: "600", color: theme.danger, marginLeft: Spacing.xs }}>
                  Blocked
                </ThemedText>
              </View>
            ) : isApprovalBlocked ? (
              <Button
                onPress={handleCapAllowance}
                style={{ flex: 1, marginLeft: Spacing.sm }}
              >
                Cap Allowance
              </Button>
            ) : (
              <Button
                onPress={handleSign}
                style={{ flex: 1, marginLeft: Spacing.sm }}
                disabled={isSigning}
              >
                {isSigning ? "Signing..." : "Sign"}
              </Button>
            )}
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
}

function MessageAnalysisContent({
  message,
  dappDomain,
  chain,
  isDomainVerified,
}: {
  message: string;
  dappDomain: string;
  chain: "solana" | "evm";
  isDomainVerified: boolean;
}) {
  const { theme } = useTheme();
  const [showRaw, setShowRaw] = useState(false);
  const [showExplain, setShowExplain] = useState(false);
  const [copied, setCopied] = useState(false);

  const analysis = useMemo(() => {
    return analyzeSignMessage({ message, dappDomain, chain, isDomainVerified });
  }, [message, dappDomain, chain, isDomainVerified]);

  const handleCopyMessage = async () => {
    await Clipboard.setStringAsync(message);
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 2000);
  };

  const riskColor = analysis.riskLevel === "low" 
    ? theme.success 
    : analysis.riskLevel === "medium" 
      ? theme.warning 
      : theme.danger;

  const riskIcon = analysis.riskLevel === "low" 
    ? "check-circle" 
    : analysis.riskLevel === "medium" 
      ? "alert-circle" 
      : "alert-triangle";

  return (
    <View>
      <View style={[styles.summaryCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.summaryHeader}>
          <ThemedText type="body" style={{ fontWeight: "600" }}>
            What you're signing
          </ThemedText>
          <Badge 
            label={analysis.riskLevel.charAt(0).toUpperCase() + analysis.riskLevel.slice(1) + " Risk"} 
            variant={analysis.riskLevel === "low" ? "success" : analysis.riskLevel === "medium" ? "warning" : "danger"} 
          />
        </View>
        
        <View style={[styles.purposeRow, { backgroundColor: theme.backgroundSecondary }]}>
          <Feather name={riskIcon as any} size={18} color={riskColor} />
          <ThemedText type="body" style={{ marginLeft: Spacing.sm, flex: 1 }}>
            {analysis.purposeLabel}
          </ThemedText>
        </View>
        
        <View style={[styles.impactRow, { backgroundColor: theme.accent + "10" }]}>
          <Feather name="shield" size={16} color={theme.accent} />
          <ThemedText type="small" style={{ marginLeft: Spacing.sm, flex: 1, color: theme.textSecondary }}>
            This does NOT move funds, and does NOT grant token approvals.
          </ThemedText>
        </View>
      </View>

      {analysis.warnings.length > 0 ? (
        <View style={[styles.warningsCard, { backgroundColor: theme.danger + "15", borderColor: theme.danger }]}>
          {analysis.warnings.map((warning, idx) => (
            <View key={idx} style={styles.warningRow}>
              <Feather name="alert-triangle" size={14} color={theme.danger} />
              <ThemedText type="small" style={{ marginLeft: Spacing.xs, flex: 1, color: theme.textSecondary }}>
                {warning}
              </ThemedText>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable 
        onPress={() => setShowExplain(!showExplain)}
        style={[styles.explainButton, { backgroundColor: theme.accent + "15", borderColor: theme.accent }]}
      >
        <Feather name="help-circle" size={18} color={theme.accent} />
        <ThemedText type="body" style={{ marginLeft: Spacing.sm, flex: 1, color: theme.accent, fontWeight: "500" }}>
          Cordon Explain
        </ThemedText>
        <Feather name={showExplain ? "chevron-up" : "chevron-down"} size={18} color={theme.accent} />
      </Pressable>

      {showExplain ? (
        <View style={[styles.explainCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.explainBullet}>
            <Feather name="info" size={14} color={theme.accent} />
            <View style={{ flex: 1, marginLeft: Spacing.sm }}>
              <ThemedText type="small" style={{ fontWeight: "600" }}>Why this is requested</ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 2 }}>
                {analysis.explainBullets.why}
              </ThemedText>
            </View>
          </View>
          <View style={styles.explainBullet}>
            <Feather name="lock" size={14} color={theme.success} />
            <View style={{ flex: 1, marginLeft: Spacing.sm }}>
              <ThemedText type="small" style={{ fontWeight: "600" }}>What it can/can't do</ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 2 }}>
                {analysis.explainBullets.capability}
              </ThemedText>
            </View>
          </View>
          <View style={styles.explainBullet}>
            <Feather name="shield" size={14} color={theme.warning} />
            <View style={{ flex: 1, marginLeft: Spacing.sm }}>
              <ThemedText type="small" style={{ fontWeight: "600" }}>Safety tip</ThemedText>
              <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 2 }}>
                {analysis.explainBullets.safetyTip}
              </ThemedText>
            </View>
          </View>
        </View>
      ) : null}

      <Pressable 
        onPress={() => setShowRaw(!showRaw)}
        style={[styles.expandHeader, { backgroundColor: theme.backgroundDefault }]}
      >
        <ThemedText type="body" style={{ fontWeight: "500" }}>
          View raw message
        </ThemedText>
        <Feather name={showRaw ? "chevron-up" : "chevron-down"} size={20} color={theme.textSecondary} />
      </Pressable>

      {showRaw ? (
        <View style={[styles.rawMessageCard, { backgroundColor: theme.backgroundDefault }]}>
          <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
            <ThemedText type="small" style={{ fontFamily: "monospace", lineHeight: 18 }}>
              {message}
            </ThemedText>
          </ScrollView>
          <Pressable 
            onPress={handleCopyMessage}
            style={[styles.copyButton, { borderColor: theme.border, marginTop: Spacing.sm }]}
          >
            <Feather name={copied ? "check" : "copy"} size={14} color={theme.textSecondary} />
            <ThemedText type="small" style={{ color: theme.textSecondary, marginLeft: Spacing.xs }}>
              {copied ? "Copied!" : "Copy message"}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function PersonalSignContent({
  request,
  dappDomain,
  isDomainVerified,
}: {
  request: PersonalSignRequest;
  dappDomain: string;
  isDomainVerified: boolean;
}) {
  return (
    <MessageAnalysisContent
      message={request.displayMessage}
      dappDomain={dappDomain}
      chain="evm"
      isDomainVerified={isDomainVerified}
    />
  );
}

function SignTypedDataContent({
  request,
  dappDomain,
}: {
  request: SignTypedDataRequest;
  dappDomain: string;
}) {
  const { theme } = useTheme();
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const domainName = (request.typedData.domain as Record<string, unknown>)?.name as string | undefined;
  const rawJson = JSON.stringify(request.typedData, null, 2);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(rawJson);
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View>
      <View style={[styles.summaryCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.summaryHeader}>
          <ThemedText type="body" style={{ fontWeight: "600" }}>
            What you're signing
          </ThemedText>
          <Badge label="Medium Risk" variant="warning" />
        </View>

        <View style={[styles.purposeRow, { backgroundColor: theme.backgroundSecondary }]}>
          <Feather name="file-text" size={18} color={theme.warning} />
          <ThemedText type="body" style={{ marginLeft: Spacing.sm, flex: 1 }}>
            {request.displaySummary}
          </ThemedText>
        </View>

        {domainName ? (
          <View style={[styles.impactRow, { backgroundColor: theme.accent + "10" }]}>
            <Feather name="globe" size={16} color={theme.accent} />
            <ThemedText type="small" style={{ marginLeft: Spacing.sm, flex: 1, color: theme.textSecondary }}>
              Domain: {domainName}
            </ThemedText>
          </View>
        ) : null}

        <View style={[styles.impactRow, { backgroundColor: theme.warning + "10", marginTop: Spacing.xs }]}>
          <Feather name="alert-circle" size={16} color={theme.warning} />
          <ThemedText type="small" style={{ marginLeft: Spacing.sm, flex: 1, color: theme.textSecondary }}>
            Typed data signatures can authorize actions. Review carefully before signing.
          </ThemedText>
        </View>
      </View>

      <Pressable
        onPress={() => setShowRaw(!showRaw)}
        style={[styles.expandHeader, { backgroundColor: theme.backgroundDefault }]}
      >
        <ThemedText type="body" style={{ fontWeight: "500" }}>
          View raw data
        </ThemedText>
        <Feather name={showRaw ? "chevron-up" : "chevron-down"} size={20} color={theme.textSecondary} />
      </Pressable>

      {showRaw ? (
        <View style={[styles.rawMessageCard, { backgroundColor: theme.backgroundDefault }]}>
          <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
            <ThemedText type="small" style={{ fontFamily: "monospace", lineHeight: 18 }}>
              {rawJson}
            </ThemedText>
          </ScrollView>
          <Pressable
            onPress={handleCopy}
            style={[styles.copyButton, { borderColor: theme.border, marginTop: Spacing.sm }]}
          >
            <Feather name={copied ? "check" : "copy"} size={14} color={theme.textSecondary} />
            <ThemedText type="small" style={{ color: theme.textSecondary, marginLeft: Spacing.xs }}>
              {copied ? "Copied!" : "Copy data"}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SolanaSignMessageContent({
  request,
  dappDomain,
  isDomainVerified,
}: {
  request: SolanaSignMessageRequest;
  dappDomain: string;
  isDomainVerified: boolean;
}) {
  return (
    <MessageAnalysisContent
      message={request.displayMessage}
      dappDomain={dappDomain}
      chain="solana"
      isDomainVerified={isDomainVerified}
    />
  );
}

function SolanaTransactionContent({
  method,
  transactionData,
  transactionCount = 1,
  dappName,
  dappDomain,
}: {
  method: string;
  transactionData?: string;
  transactionCount?: number;
  dappName: string;
  dappDomain: string;
}) {
  const { theme } = useTheme();
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isMultiple = method === "solana_signAllTransactions";
  
  const decoded = useMemo(() => {
    if (!transactionData) return null;
    return decodeSolanaTransaction(transactionData);
  }, [transactionData]);
  
  const handleCopyTxData = async () => {
    if (transactionData) {
      await Clipboard.setStringAsync(transactionData);
      setCopied(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  const riskColor = decoded?.riskLevel === "Blocked"
    ? theme.danger
    : decoded?.riskLevel === "Low" 
      ? theme.success 
      : decoded?.riskLevel === "Medium" 
        ? theme.warning 
        : theme.danger;
  
  const isBlocked = decoded?.drainerDetection?.isBlocked === true;
  
  return (
    <View>
      <View style={[styles.contentCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Requested by
          </ThemedText>
          <ThemedText type="body" style={{ fontWeight: "500" }}>
            {dappName}
          </ThemedText>
        </View>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Domain
          </ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {dappDomain}
          </ThemedText>
        </View>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Via
          </ThemedText>
          <Badge label="WalletConnect" variant="neutral" />
        </View>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Type
          </ThemedText>
          <Badge 
            label={isMultiple ? `Batch (${transactionCount} txs)` : decoded?.isSimpleTransfer ? "Transfer" : "Transaction"} 
            variant="neutral" 
          />
        </View>
      </View>
      
      {isBlocked ? (
        <View style={[styles.riskCard, { backgroundColor: theme.danger + "20", borderColor: theme.danger, borderWidth: 2 }]}>
          <Feather name="shield-off" size={24} color={theme.danger} />
          <View style={{ flex: 1, marginLeft: Spacing.sm }}>
            <ThemedText type="body" style={{ fontWeight: "700", color: theme.danger }}>
              WALLET DRAINER DETECTED
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 4 }}>
              {decoded?.drainerDetection?.attackType === "SetAuthority" 
                ? "This transaction tries to change your token account ownership. If signed, an attacker would gain permanent control of your tokens."
                : "This transaction tries to reassign your wallet to a malicious program. If signed, you would permanently lose access to your funds."}
            </ThemedText>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: Spacing.sm }}>
              <Feather name="x-circle" size={14} color={theme.danger} />
              <ThemedText type="small" style={{ marginLeft: Spacing.xs, color: theme.danger, fontWeight: "600" }}>
                Signing is blocked for your protection
              </ThemedText>
            </View>
          </View>
        </View>
      ) : decoded ? (
        <View style={[styles.riskCard, { backgroundColor: riskColor + "15", borderColor: riskColor }]}>
          <Feather 
            name={decoded.riskLevel === "Low" ? "check-circle" : decoded.riskLevel === "Medium" ? "alert-circle" : "alert-triangle"} 
            size={18} 
            color={riskColor} 
          />
          <View style={{ flex: 1, marginLeft: Spacing.sm }}>
            <ThemedText type="small" style={{ fontWeight: "600", color: riskColor }}>
              {decoded.riskLevel} Risk
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 2 }}>
              {decoded.riskReason}
            </ThemedText>
          </View>
        </View>
      ) : null}
      
      <Pressable 
        onPress={() => setDetailsExpanded(!detailsExpanded)}
        style={[styles.expandHeader, { backgroundColor: theme.backgroundDefault }]}
      >
        <ThemedText type="body" style={{ fontWeight: "500" }}>
          View details
        </ThemedText>
        <Feather 
          name={detailsExpanded ? "chevron-up" : "chevron-down"} 
          size={20} 
          color={theme.textSecondary} 
        />
      </Pressable>
      
      {detailsExpanded && decoded ? (
        <View style={[styles.detailsCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Instructions
            </ThemedText>
            <ThemedText type="body">{decoded.instructionCount}</ThemedText>
          </View>
          
          <View style={{ marginTop: Spacing.sm }}>
            <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.xs }}>
              Programs
            </ThemedText>
            {decoded.programLabels.map((label, idx) => (
              <View key={idx} style={styles.programRow}>
                <View style={[styles.programDot, { backgroundColor: decoded.unknownProgramIds.includes(decoded.programIds[idx]) ? theme.warning : theme.success }]} />
                <ThemedText type="small" style={{ flex: 1 }}>
                  {label}
                </ThemedText>
              </View>
            ))}
          </View>
          
          {transactionData ? (
            <Pressable 
              onPress={handleCopyTxData}
              style={[styles.copyButton, { borderColor: theme.border }]}
            >
              <Feather name={copied ? "check" : "copy"} size={14} color={theme.textSecondary} />
              <ThemedText type="small" style={{ color: theme.textSecondary, marginLeft: Spacing.xs }}>
                {copied ? "Copied!" : "Copy raw transaction data"}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function SolanaBatchTransactionContent({
  transactions,
  dappName,
  dappDomain,
}: {
  transactions: string[];
  dappName: string;
  dappDomain: string;
}) {
  const { theme } = useTheme();
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  
  const decoded = useMemo(() => {
    if (!transactions || transactions.length === 0) return null;
    return decodeSolanaTransactions(transactions);
  }, [transactions]);
  
  const riskColor = decoded?.riskLevel === "Blocked"
    ? theme.danger
    : decoded?.riskLevel === "Low" 
      ? theme.success 
      : decoded?.riskLevel === "Medium" 
        ? theme.warning 
        : theme.danger;
  
  const isBlocked = decoded?.drainerDetection?.isBlocked === true;
  
  return (
    <View>
      <View style={[styles.contentCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Requested by
          </ThemedText>
          <ThemedText type="body" style={{ fontWeight: "500" }}>
            {dappName}
          </ThemedText>
        </View>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Domain
          </ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {dappDomain}
          </ThemedText>
        </View>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Via
          </ThemedText>
          <Badge label="WalletConnect" variant="neutral" />
        </View>
        <View style={styles.txRow}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Type
          </ThemedText>
          <Badge label={`Batch (${transactions.length} txs)`} variant="warning" />
        </View>
      </View>
      
      {isBlocked ? (
        <View style={[styles.riskCard, { backgroundColor: theme.danger + "20", borderColor: theme.danger, borderWidth: 2 }]}>
          <Feather name="shield-off" size={24} color={theme.danger} />
          <View style={{ flex: 1, marginLeft: Spacing.sm }}>
            <ThemedText type="body" style={{ fontWeight: "700", color: theme.danger }}>
              WALLET DRAINER DETECTED
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 4 }}>
              {decoded?.drainerDetection?.attackType === "SetAuthority" 
                ? "One or more transactions in this batch try to change your token account ownership. If signed, an attacker would gain permanent control of your tokens."
                : "One or more transactions in this batch try to reassign your wallet to a malicious program. If signed, you would permanently lose access to your funds."}
            </ThemedText>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: Spacing.sm }}>
              <Feather name="x-circle" size={14} color={theme.danger} />
              <ThemedText type="small" style={{ marginLeft: Spacing.xs, color: theme.danger, fontWeight: "600" }}>
                Signing is blocked for your protection
              </ThemedText>
            </View>
          </View>
        </View>
      ) : decoded ? (
        <View style={[styles.riskCard, { backgroundColor: riskColor + "15", borderColor: riskColor }]}>
          <Feather 
            name={decoded.riskLevel === "Low" ? "check-circle" : decoded.riskLevel === "Medium" ? "alert-circle" : "alert-triangle"} 
            size={18} 
            color={riskColor} 
          />
          <View style={{ flex: 1, marginLeft: Spacing.sm }}>
            <ThemedText type="small" style={{ fontWeight: "600", color: riskColor }}>
              {decoded.riskLevel} Risk
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 2 }}>
              {decoded.riskReason}
            </ThemedText>
          </View>
        </View>
      ) : null}
      
      <Pressable 
        onPress={() => setDetailsExpanded(!detailsExpanded)}
        style={[styles.expandHeader, { backgroundColor: theme.backgroundDefault }]}
      >
        <ThemedText type="body" style={{ fontWeight: "500" }}>
          View details
        </ThemedText>
        <Feather 
          name={detailsExpanded ? "chevron-up" : "chevron-down"} 
          size={20} 
          color={theme.textSecondary} 
        />
      </Pressable>
      
      {detailsExpanded && decoded ? (
        <View style={[styles.detailsCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Total Transactions
            </ThemedText>
            <ThemedText type="body">{transactions.length}</ThemedText>
          </View>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Total Instructions
            </ThemedText>
            <ThemedText type="body">{decoded.instructionCount}</ThemedText>
          </View>
          
          <View style={{ marginTop: Spacing.sm }}>
            <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.xs }}>
              Programs (across all transactions)
            </ThemedText>
            {decoded.programLabels.map((label, idx) => (
              <View key={idx} style={styles.programRow}>
                <View style={[styles.programDot, { backgroundColor: decoded.unknownProgramIds.includes(decoded.programIds[idx]) ? theme.warning : theme.success }]} />
                <ThemedText type="small" style={{ flex: 1 }}>
                  {label}
                </ThemedText>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SendTransactionContent({
  request,
  isApprovalBlocked,
}: {
  request: SendTransactionRequest;
  isApprovalBlocked: boolean;
}) {
  const { theme } = useTheme();
  const { tx, chainId, valueFormatted, approval, isApproval, isNativeTransfer } = request;
  const chain = getChainById(chainId);
  const nativeSymbol = chain?.nativeSymbol || "ETH";

  const spenderLabel = approval
    ? getSpenderLabel(chainId, approval.spender) || shortenAddress(approval.spender)
    : "";

  return (
    <View style={[styles.contentCard, { backgroundColor: theme.backgroundDefault }]}>
      {isApproval && approval ? (
        <>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Type
            </ThemedText>
            <Badge label="Token Approval" variant={isApprovalBlocked ? "danger" : "warning"} />
          </View>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Token
            </ThemedText>
            <ThemedText type="body">{shortenAddress(approval.tokenAddress)}</ThemedText>
          </View>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Spender
            </ThemedText>
            <ThemedText type="body">{spenderLabel}</ThemedText>
          </View>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Amount
            </ThemedText>
            <ThemedText
              type="body"
              style={{ color: approval.isUnlimited ? theme.danger : theme.text, fontWeight: "600" }}
            >
              {approval.isUnlimited ? "UNLIMITED" : formatAllowance(approval.amountRaw, 18, "")}
            </ThemedText>
          </View>
        </>
      ) : isNativeTransfer ? (
        <>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Type
            </ThemedText>
            <Badge label="Transfer" variant="neutral" />
          </View>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              To
            </ThemedText>
            <ThemedText type="body">{shortenAddress(tx.to)}</ThemedText>
          </View>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Amount
            </ThemedText>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {valueFormatted} {nativeSymbol}
            </ThemedText>
          </View>
        </>
      ) : (
        <>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Type
            </ThemedText>
            <Badge label="Contract Interaction" variant="neutral" />
          </View>
          <View style={styles.txRow}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              To
            </ThemedText>
            <ThemedText type="body">{shortenAddress(tx.to)}</ThemedText>
          </View>
          {parseFloat(valueFormatted) > 0 ? (
            <View style={styles.txRow}>
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                Value
              </ThemedText>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {valueFormatted} {nativeSymbol}
              </ThemedText>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function shortenAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
    maxHeight: "85%",
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
  dappRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  dappIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  dappIconImage: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  unverifiedWarning: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  contentCard: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  txRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
  blockedCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: Spacing.lg,
  },
  buttons: {
    flexDirection: "row",
    marginTop: Spacing.md,
  },
  secondaryButton: {
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  blockedButton: {
    flexDirection: "row",
    padding: Spacing.md,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  riskCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  expandHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: 12,
    marginBottom: Spacing.md,
  },
  detailsCard: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  programRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
  programDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.sm,
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
    marginBottom: Spacing.md,
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
  warningsCard: {
    borderRadius: 12,
    padding: Spacing.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.xs,
  },
  explainButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  explainCard: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  explainBullet: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: Spacing.md,
  },
  rawMessageCard: {
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: Spacing.md,
  },
});
