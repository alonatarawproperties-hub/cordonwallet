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
  SolanaSignMessageRequest,
  SolanaSignTransactionRequest,
  SolanaSignAllTransactionsRequest,
  ParsedRequest,
  getChainName,
} from "@/lib/walletconnect/handlers";
import { getChainById } from "@/lib/blockchain/chains";
import { formatAllowance } from "@/lib/approvals/firewall";
import { getSpenderLabel } from "@/lib/approvals/spenders";
import { decodeSolanaTransaction, decodeSolanaTransactions, DecodedSolanaTransaction } from "@/lib/solana/decoder";

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
              <PersonalSignContent request={parsed as PersonalSignRequest} />
            ) : null}

            {isSendTx ? (
              <SendTransactionContent
                request={parsed as SendTransactionRequest}
                isApprovalBlocked={isApprovalBlocked}
              />
            ) : null}

            {parsed.method === "solana_signMessage" ? (
              <SolanaSignMessageContent request={parsed as SolanaSignMessageRequest} />
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
              <ThemedText type="body" style={{ fontWeight: "600" }}>Reject</ThemedText>
            </Pressable>
            {isApprovalBlocked ? (
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

function PersonalSignContent({
  request,
}: {
  request: PersonalSignRequest;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.contentCard, { backgroundColor: theme.backgroundDefault }]}>
      <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
        Message to sign:
      </ThemedText>
      <ThemedText type="body" style={{ lineHeight: 22 }}>
        {request.displayMessage}
      </ThemedText>
    </View>
  );
}

function SolanaSignMessageContent({
  request,
}: {
  request: SolanaSignMessageRequest;
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.contentCard, { backgroundColor: theme.backgroundDefault }]}>
      <ThemedText type="small" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
        Message to sign:
      </ThemedText>
      <ThemedText type="body" style={{ lineHeight: 22 }}>
        {request.displayMessage}
      </ThemedText>
    </View>
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
  
  const riskColor = decoded?.riskLevel === "Low" 
    ? theme.success 
    : decoded?.riskLevel === "Medium" 
      ? theme.warning 
      : theme.danger;
  
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
      
      {decoded ? (
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
  
  const riskColor = decoded?.riskLevel === "Low" 
    ? theme.success 
    : decoded?.riskLevel === "Medium" 
      ? theme.warning 
      : theme.danger;
  
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
      
      {decoded ? (
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
