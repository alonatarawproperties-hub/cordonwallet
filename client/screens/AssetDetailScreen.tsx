import { useState, useEffect, useLayoutEffect, useCallback } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { GlassView } from "expo-glass-effect";
import { Connection } from "@solana/web3.js";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { PnlChart } from "@/components/PnlChart";
import { PriceChart } from "@/components/PriceChart";
import { useWallet } from "@/lib/wallet-context";
import { fetchTransactionHistory } from "@/lib/blockchain/explorer-api";
import { TxRecord, getTransactionsByWallet, filterTreasuryTransactions } from "@/lib/transaction-history";
import { getApiUrl } from "@/lib/query-client";
import { getTokenLogoUrl } from "@/lib/token-logos";
import {
  TokenSafetyReportV2,
  SafetyFinding,
  SafetyLevel,
} from "@/types/tokenSafety";
import { getTokenSafetyV2 } from "@/services/tokenSafetyV2";

function getV2StatusColor(level: SafetyLevel): string {
  switch (level) {
    case "safe": return "#22C55E";
    case "warning": return "#F59E0B";
    case "danger": return "#EF4444";
    case "info": return "#8B92A8";
    default: return "#8B92A8";
  }
}

function getV2StatusIcon(level: SafetyLevel): React.ComponentProps<typeof Feather>["name"] {
  switch (level) {
    case "safe": return "check-circle";
    case "warning": return "alert-triangle";
    case "danger": return "alert-octagon";
    case "info": return "info";
    default: return "help-circle";
  }
}

function getV2BadgeText(finding: SafetyFinding): string {
  if (finding.verified === "not_verified") return "Not verified";
  if (finding.verified === "unavailable") return "Unavailable";
  switch (finding.level) {
    case "safe": return "Safe";
    case "warning": return "Caution";
    case "danger": return "Risk";
    case "info": return "Info";
    default: return "Info";
  }
}

function formatV2ScanTime(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "AssetDetail">;
type Navigation = NativeStackNavigationProp<RootStackParamList>;

type TabType = "holdings" | "history" | "about";

interface TokenInfo {
  description?: string;
  marketCap?: number;
  circulatingSupply?: number;
  totalSupply?: number;
  website?: string;
  explorer?: string;
  twitter?: string;
}

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (price >= 1) {
    return price.toFixed(2);
  } else if (price >= 0.01) {
    return price.toFixed(4);
  } else {
    return price.toFixed(6);
  }
}

function formatLargeNumber(num: number): string {
  if (num >= 1e12) {
    return `$${(num / 1e12).toFixed(2)}T`;
  } else if (num >= 1e9) {
    return `$${(num / 1e9).toFixed(2)}B`;
  } else if (num >= 1e6) {
    return `$${(num / 1e6).toFixed(2)}M`;
  }
  return `$${num.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatSupply(num: number, symbol: string): string {
  if (num >= 1e12) {
    return `${(num / 1e12).toFixed(3)}T ${symbol}`;
  } else if (num >= 1e9) {
    return `${(num / 1e9).toFixed(3)}B ${symbol}`;
  } else if (num >= 1e6) {
    return `${(num / 1e6).toFixed(3)}M ${symbol}`;
  }
  return `${num.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${symbol}`;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTxAmount(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount.replace(/,/g, "")) : amount;
  if (isNaN(num)) return "0";
  
  // For very large numbers, use K/M notation
  if (Math.abs(num) >= 1_000_000) {
    return (num / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "M";
  }
  if (Math.abs(num) >= 100_000) {
    return (num / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "K";
  }
  
  // For regular numbers, use commas with 2-4 decimals
  if (Math.abs(num) >= 1000) {
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (Math.abs(num) >= 1) {
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  // For small amounts, show more precision
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function getChainColor(chainName: string): string {
  const colorMap: Record<string, string> = {
    Ethereum: "#627EEA",
    Polygon: "#8247E5",
    "BNB Chain": "#F3BA2F",
    Arbitrum: "#12AAFF",
    Base: "#0052FF",
    Solana: "#9945FF",
  };
  return colorMap[chainName] || "#888";
}

export default function AssetDetailScreen({ route }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const navigation = useNavigation<Navigation>();
  const { activeWallet } = useWallet();
  
  const {
    tokenSymbol,
    tokenName,
    balance,
    chainId,
    chainName,
    isNative,
    address,
    priceUsd,
    valueUsd,
    priceChange24h,
    logoUrl,
    decimals,
  } = route.params;
  
  const tokenLogoUrl = logoUrl || getTokenLogoUrl(tokenSymbol);

  const [activeTab, setActiveTab] = useState<TabType>("holdings");
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [pnlData, setPnlData] = useState<{ timestamp: number; value: number }[]>([]);
  const [securityReport, setSecurityReport] = useState<TokenSafetyReportV2 | null>(null);
  const [isScanningSecurity, setIsScanningSecurity] = useState(false);
  const [securityExpanded, setSecurityExpanded] = useState(true);

  useEffect(() => {
    if (activeWallet && transactions.length === 0) {
      loadTransactionHistory();
    }
  }, [activeWallet]);

  useEffect(() => {
    if (activeTab === "about" && !tokenInfo) {
      loadTokenInfo();
    }
  }, [activeTab]);

  useEffect(() => {
    if (priceUsd) {
      calculatePnlData();
    }
  }, [priceUsd, balance, priceChange24h, transactions]);

  useEffect(() => {
    if (activeTab !== "about") return;
    const isSolana = chainName === "Solana" || chainId === 0;
    if (!isSolana) {
      setSecurityReport(null);
      return;
    }
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const mintAddress = (tokenSymbol === "SOL" && isNative) ? SOL_MINT : address;
    if (!mintAddress) {
      setSecurityReport(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsScanningSecurity(true);
      try {
        const connection = new Connection(SOLANA_RPC_URL, "confirmed");
        const result = await getTokenSafetyV2({ connection, mint: mintAddress });
        if (!cancelled) {
          setSecurityReport(result);
        }
      } catch (err) {
        console.error("[SecurityScan] Scan failed:", err);
      } finally {
        if (!cancelled) setIsScanningSecurity(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, address, chainName, chainId, tokenSymbol, isNative]);

  const onRescanSecurity = useCallback(async () => {
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const mintAddress = (tokenSymbol === "SOL" && isNative) ? SOL_MINT : address;
    if (!mintAddress) return;
    setIsScanningSecurity(true);
    try {
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      const result = await getTokenSafetyV2({ connection, mint: mintAddress, forceRefresh: true });
      setSecurityReport(result);
    } catch (err) {
      console.error("[SecurityScan] Rescan failed:", err);
    } finally {
      setIsScanningSecurity(false);
    }
  }, [address, tokenSymbol, isNative]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={styles.navHeaderTitle}>
          <View style={[styles.navTokenIcon, { backgroundColor: theme.accent + "20" }]}>
            {tokenLogoUrl ? (
              <Image source={{ uri: tokenLogoUrl }} style={styles.navTokenLogo} />
            ) : (
              <ThemedText type="small" style={{ color: theme.accent, fontWeight: "600" }}>
                {tokenSymbol.slice(0, 2)}
              </ThemedText>
            )}
          </View>
          <ThemedText type="body" style={{ fontWeight: "600" }}>{tokenSymbol}</ThemedText>
          <View style={[styles.navChainPill, { backgroundColor: getChainColor(chainName) + "20" }]}>
            <ThemedText type="small" style={{ color: getChainColor(chainName), fontSize: 10 }}>
              {chainName}
            </ThemedText>
          </View>
        </View>
      ),
    });
  }, [navigation, tokenSymbol, chainName, theme, tokenLogoUrl]);

  const calculatePnlData = () => {
    if (!priceUsd) return;
    
    // Parse balance, removing commas and special characters
    const balanceStr = String(balance).replace(/[<>,]/g, '');
    const balanceNum = parseFloat(balanceStr) || 0;
    if (balanceNum <= 0) {
      setPnlData([]);
      return;
    }
    
    // Calculate 24h PnL based on current balance and price change
    // This is reliable since we have accurate current price and 24h change data
    const priceYesterday = priceUsd / (1 + (priceChange24h || 0) / 100);
    const currentValue = balanceNum * priceUsd;
    const valueYesterday = balanceNum * priceYesterday;
    const pnl24h = currentValue - valueYesterday;
    
    const now = Date.now();
    const yesterday = now - 24 * 60 * 60 * 1000;
    
    // Create simple 24h P&L chart data
    const pnlPoints: { timestamp: number; value: number }[] = [
      { timestamp: yesterday, value: 0 },
      { timestamp: now, value: pnl24h },
    ];
    
    setPnlData(pnlPoints);
  };

  const loadTransactionHistory = async () => {
    if (!activeWallet) return;
    setIsLoadingHistory(true);
    try {
      let allTxs: TxRecord[] = [];
      
      if (chainId === 0) {
        const solanaAddr = activeWallet.addresses?.solana || "";
        if (solanaAddr) {
          // Fetch from blockchain API for Solana transaction history
          try {
            const apiUrl = getApiUrl();
            const url = new URL(`/api/solana/history/${solanaAddr}`, apiUrl);
            url.searchParams.set("limit", "30");
            const response = await fetch(url.toString());
            
            if (response.ok) {
              const solanaHistory = await response.json();
              // Convert Solana API response to TxRecord format and filter by token
              allTxs = solanaHistory
                .filter((tx: any) => {
                  // For native SOL viewing
                  if (isNative && tx.tokenSymbol === "SOL") return true;
                  // For swaps involving SOL, check swapInfo
                  if (isNative && tx.type === "swap" && tx.swapInfo) {
                    return tx.swapInfo.fromSymbol === "SOL" || tx.swapInfo.toSymbol === "SOL";
                  }
                  // For SPL token viewing - match by mint address
                  if (!isNative && address && tx.tokenMint === address) return true;
                  // For SPL token - check swapInfo for token involvement
                  if (!isNative && tx.type === "swap" && tx.swapInfo) {
                    return tx.swapInfo.fromSymbol === tokenSymbol || tx.swapInfo.toSymbol === tokenSymbol;
                  }
                  if (!isNative && tx.tokenSymbol === tokenSymbol) return true;
                  return false;
                })
                .map((tx: any) => {
                  // Determine activity type correctly for swaps
                  let activityType: "send" | "receive" | "swap" = "send";
                  let displayAmount = tx.amount || "0";
                  let displaySymbol = tx.tokenSymbol || tokenSymbol;
                  
                  if (tx.type === "swap" && tx.swapInfo) {
                    activityType = "swap";
                    // Determine if user received or sent the token being viewed
                    const viewingSymbol = isNative ? "SOL" : tokenSymbol;
                    if (tx.swapInfo.toSymbol === viewingSymbol) {
                      // User received this token in the swap
                      displayAmount = tx.swapInfo.toAmount;
                      displaySymbol = tx.swapInfo.toSymbol;
                    } else if (tx.swapInfo.fromSymbol === viewingSymbol) {
                      // User sent this token in the swap
                      displayAmount = tx.swapInfo.fromAmount;
                      displaySymbol = tx.swapInfo.fromSymbol;
                    }
                  } else if (tx.type === "send") {
                    activityType = "send";
                  } else if (tx.type === "receive") {
                    activityType = "receive";
                  }
                  
                  return {
                    id: tx.signature,
                    hash: tx.signature,
                    chainId: 0,
                    activityType,
                    tokenSymbol: displaySymbol,
                    tokenAddress: tx.tokenMint || address,
                    amount: displayAmount,
                    from: tx.from || "",
                    to: tx.to || "",
                    status: tx.err ? "failed" : "confirmed",
                    createdAt: tx.blockTime ? tx.blockTime * 1000 : Date.now(),
                    explorerUrl: `https://solscan.io/tx/${tx.signature}`,
                    walletAddress: activeWallet?.addresses?.solana || "",
                    type: tx.type || "transfer",
                    swapInfo: tx.swapInfo,
                  } as TxRecord;
                });
            }
          } catch (apiError) {
            console.error("Failed to fetch Solana history from API:", apiError);
          }
          
          // Also merge with local transactions for pending/recent ones
          const localTxs = await getTransactionsByWallet(solanaAddr);
          const localFiltered = localTxs.filter(tx => 
            tx.chainId === 0 && 
            (tx.tokenSymbol === tokenSymbol || 
             (address && tx.tokenAddress?.toLowerCase() === address.toLowerCase()))
          );
          
          // Merge and dedupe by hash
          const seenHashes = new Set(allTxs.map(tx => tx.hash));
          for (const localTx of localFiltered) {
            if (!seenHashes.has(localTx.hash)) {
              allTxs.push(localTx);
            }
          }
          
          // Sort by timestamp descending
          allTxs.sort((a, b) => b.createdAt - a.createdAt);
        }
      } else {
        const history = await fetchTransactionHistory(activeWallet.address, chainId);
        allTxs = history.filter(tx => {
          if (tx.tokenSymbol.toUpperCase() === tokenSymbol.toUpperCase()) return true;
          if (address && tx.tokenAddress?.toLowerCase() === address.toLowerCase()) return true;
          return false;
        });
      }
      
      setTransactions(filterTreasuryTransactions(allTxs));
    } catch (error) {
      console.error("Failed to load transaction history:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const loadTokenInfo = async () => {
    setIsLoadingInfo(true);
    try {
      const apiUrl = getApiUrl();
      const url = new URL(`/api/token-info/${tokenSymbol}`, apiUrl);
      url.searchParams.set("chainId", String(chainId));
      if (address) {
        url.searchParams.set("address", address);
      }
      const response = await fetch(url.toString());
      if (response.ok) {
        const data = await response.json();
        setTokenInfo(data);
      }
    } catch (error) {
      console.error("Failed to load token info:", error);
    } finally {
      setIsLoadingInfo(false);
    }
  };

  const balanceNumForChange = parseFloat(String(balance).replace(/,/g, '')) || 0;
  const change24hValue = priceUsd && priceChange24h
    ? (balanceNumForChange * priceUsd * priceChange24h) / 100
    : 0;

  const handleTransactionPress = (tx: TxRecord) => {
    const activityType = (tx.activityType === "send" || tx.activityType === "receive" || tx.activityType === "swap")
      ? tx.activityType
      : "send";
    
    navigation.navigate("TransactionDetail", {
      hash: tx.hash,
      chainId: tx.chainId,
      activityType,
      tokenSymbol: tx.tokenSymbol,
      amount: tx.amount,
      to: tx.to,
      from: tx.from,
      status: tx.status,
      createdAt: tx.createdAt,
      explorerUrl: tx.explorerUrl,
    });
  };

  const tabs: { key: TabType; label: string }[] = [
    { key: "holdings", label: "Holdings" },
    { key: "history", label: "History" },
    { key: "about", label: "About" },
  ];

  const totalPnl = pnlData.length > 0 ? pnlData[pnlData.length - 1].value : 0;
  const balanceNumDisplay = parseFloat(String(balance).replace(/[<>,]/g, '')) || 0;
  const currentValue = balanceNumDisplay * (priceUsd || 0);
  const pnlPercent = priceChange24h || 0;

  const renderHoldingsTab = () => (
    <View style={styles.tabContent}>
      <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
        My Balance
      </ThemedText>
      <View style={[styles.holdingCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.holdingRow}>
          <View style={styles.holdingChain}>
            {tokenLogoUrl ? (
              <Image source={{ uri: tokenLogoUrl }} style={styles.holdingTokenLogo} />
            ) : (
              <View style={[styles.chainDot, { backgroundColor: getChainColor(chainName) }]} />
            )}
            <ThemedText type="body">{tokenName}</ThemedText>
          </View>
          <View style={styles.holdingValues}>
            <ThemedText type="body" style={{ fontWeight: "600", textAlign: "right" }}>
              {valueUsd ? `$${formatPrice(valueUsd)}` : "-"}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "right" }}>
              {balance} {tokenSymbol}
            </ThemedText>
          </View>
        </View>
        <View style={[styles.pnlRow, { borderTopColor: theme.border }]}>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            24h Change
          </ThemedText>
          <ThemedText
            type="caption"
            style={{
              color: (priceChange24h || 0) >= 0 ? "#22C55E" : "#EF4444",
              fontWeight: "600",
            }}
          >
            {change24hValue >= 0 ? "+" : ""}${Math.abs(change24hValue).toFixed(2)} ({priceChange24h?.toFixed(2) || 0}%)
          </ThemedText>
        </View>
      </View>
    </View>
  );

  const renderHistoryTab = () => (
    <View style={styles.tabContent}>
      {isLoadingHistory ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={theme.accent} />
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Loading transactions...
          </ThemedText>
        </View>
      ) : transactions.length === 0 ? (
        <View style={[styles.emptyState, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="clock" size={32} color={theme.textSecondary} />
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            No transactions yet
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
            Transactions for {tokenSymbol} on {chainName} will appear here
          </ThemedText>
        </View>
      ) : (
        transactions.map((tx) => {
          // Determine display properties based on activity type and swap info
          const isSwap = tx.activityType === "swap";
          const viewingSymbol = isNative ? "SOL" : tokenSymbol;
          
          // For swaps, determine if user received or sent the token being viewed
          let isReceiving = tx.activityType === "receive";
          if (isSwap && tx.swapInfo) {
            isReceiving = tx.swapInfo.toSymbol === viewingSymbol;
          }
          
          const iconName = isSwap ? "repeat" : (isReceiving ? "arrow-down-left" : "arrow-up-right");
          const iconColor = isReceiving ? theme.success : theme.accent;
          const bgColor = isReceiving ? theme.success + "20" : theme.accent + "20";
          
          const txLabel = isSwap 
            ? (isReceiving ? "Swapped for" : "Swapped away")
            : (isReceiving ? "Received" : "Sent");
          
          const amountPrefix = isReceiving ? "+" : "-";
          const amountColor = isReceiving ? theme.success : theme.text;
          
          return (
            <Pressable
              key={tx.id}
              style={[styles.txRow, { backgroundColor: theme.backgroundDefault }]}
              onPress={() => handleTransactionPress(tx)}
            >
              <View style={[styles.txIcon, { backgroundColor: bgColor }]}>
                <Feather name={iconName} size={18} color={iconColor} />
              </View>
              <View style={styles.txInfo}>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  {txLabel}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {formatDate(tx.createdAt)}
                </ThemedText>
              </View>
              <View style={styles.txAmount}>
                <ThemedText
                  type="body"
                  style={{
                    fontWeight: "600",
                    color: amountColor,
                    textAlign: "right",
                  }}
                >
                  {amountPrefix}{formatTxAmount(tx.amount)} {tx.tokenSymbol}
                </ThemedText>
                <View style={[styles.statusBadge, { backgroundColor: tx.status === "confirmed" ? theme.success + "20" : theme.warning + "20" }]}>
                  <ThemedText
                    type="caption"
                    style={{ color: tx.status === "confirmed" ? theme.success : theme.warning, fontSize: 10 }}
                  >
                    {tx.status === "confirmed" ? "Confirmed" : "Pending"}
                  </ThemedText>
                </View>
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );

  const renderAboutTab = () => (
    <View style={styles.tabContent}>
      {isLoadingInfo ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={theme.accent} />
        </View>
      ) : (
        <>
          <View style={styles.aboutSection}>
            <ThemedText type="h4" style={{ marginBottom: Spacing.sm }}>
              About {tokenSymbol}
            </ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary, lineHeight: 22 }}>
              {tokenInfo?.description || getDefaultDescription(tokenSymbol, chainName)}
            </ThemedText>
          </View>

          <View style={styles.aboutSection}>
            <ThemedText type="h4" style={{ marginBottom: Spacing.md }}>
              Stats
            </ThemedText>
            <View style={[styles.statsCard, { backgroundColor: theme.backgroundDefault }]}>
              <View style={styles.statRow}>
                <ThemedText type="body" style={{ color: theme.textSecondary }}>
                  Market cap
                </ThemedText>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  {tokenInfo?.marketCap ? formatLargeNumber(tokenInfo.marketCap) : getDefaultMarketCap(tokenSymbol)}
                </ThemedText>
              </View>
              <View style={[styles.statRow, { borderTopWidth: 1, borderTopColor: theme.border }]}>
                <ThemedText type="body" style={{ color: theme.textSecondary }}>
                  Circulating Supply
                </ThemedText>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  {tokenInfo?.circulatingSupply ? formatSupply(tokenInfo.circulatingSupply, tokenSymbol) : "-"}
                </ThemedText>
              </View>
              <View style={[styles.statRow, { borderTopWidth: 1, borderTopColor: theme.border }]}>
                <ThemedText type="body" style={{ color: theme.textSecondary }}>
                  Total Supply
                </ThemedText>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  {tokenInfo?.totalSupply ? formatSupply(tokenInfo.totalSupply, tokenSymbol) : "-"}
                </ThemedText>
              </View>
            </View>
          </View>

          <View style={styles.aboutSection}>
            <ThemedText type="h4" style={{ marginBottom: Spacing.md }}>
              Links
            </ThemedText>
            <View style={styles.linksRow}>
              {getTokenLinks(tokenSymbol, chainId, address, tokenInfo).map((link, index) => (
                <Pressable
                  key={index}
                  style={[styles.linkButton, { backgroundColor: theme.accent + "20" }]}
                  onPress={() => WebBrowser.openBrowserAsync(link.url)}
                >
                  <ThemedText type="small" style={{ color: theme.accent }}>
                    {link.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          {(chainName === "Solana" || chainId === 0) && (
            <View style={styles.aboutSection}>
              <View style={styles.securityHeader}>
                <Pressable
                  style={styles.securityHeaderLeft}
                  onPress={() => setSecurityExpanded(!securityExpanded)}
                >
                  <ThemedText type="h4">Contract Security</ThemedText>
                  <View style={[
                    styles.securityPill,
                    { backgroundColor: securityReport ? theme.success + "20" : theme.textSecondary + "20" }
                  ]}>
                    <ThemedText
                      type="small"
                      style={{ color: securityReport ? theme.success : theme.textSecondary, fontWeight: "600" }}
                    >
                      {isScanningSecurity ? "Scanning..." : securityReport ? "Scanned" : "Not scanned"}
                    </ThemedText>
                  </View>
                  <Feather
                    name={securityExpanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={theme.textSecondary}
                  />
                </Pressable>
                {!isScanningSecurity && securityReport ? (
                  <Pressable
                    style={[styles.rescanButton, { backgroundColor: theme.accent + "15" }]}
                    onPress={onRescanSecurity}
                  >
                    <Feather name="refresh-cw" size={12} color={theme.accent} />
                    <ThemedText type="small" style={{ color: theme.accent, marginLeft: 4 }}>
                      Rescan
                    </ThemedText>
                  </Pressable>
                ) : null}
              </View>

              {securityReport && !isScanningSecurity ? (
                <>
                  <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4, marginBottom: Spacing.sm }}>
                    {securityReport.sourceLabel} • {formatV2ScanTime(securityReport.scannedAt)}
                  </ThemedText>
                  <View style={[styles.securityPill, { backgroundColor: getV2StatusColor(securityReport.verdict.level) + "20", marginBottom: Spacing.sm }]}>
                    <ThemedText type="small" style={{ color: getV2StatusColor(securityReport.verdict.level), fontWeight: "600" }}>
                      {securityReport.verdict.label}
                    </ThemedText>
                  </View>
                </>
              ) : null}

              {securityExpanded && (
                <View style={[styles.statsCard, { backgroundColor: theme.backgroundDefault, marginTop: securityReport ? 0 : Spacing.sm }]}>
                  {isScanningSecurity && !securityReport ? (
                    <View style={[styles.statRow, { justifyContent: "center" }]}>
                      <ActivityIndicator size="small" color={theme.accent} />
                      <ThemedText type="body" style={{ color: theme.textSecondary, marginLeft: Spacing.sm }}>
                        Scanning contract...
                      </ThemedText>
                    </View>
                  ) : securityReport ? (
                    <>
                      {securityReport.findings.map((finding, index) => {
                        const color = getV2StatusColor(finding.level);
                        const iconName = getV2StatusIcon(finding.level);
                        const isProgram = finding.key === "tokenProgram";
                        const badgeText = getV2BadgeText(finding);
                        return (
                          <View
                            key={finding.key}
                            style={[
                              styles.securityCheckRow,
                              index > 0 && { borderTopWidth: 1, borderTopColor: theme.border },
                            ]}
                          >
                            <View style={styles.securityCheckLeft}>
                              <Feather name={iconName} size={16} color={color} />
                              <View style={styles.securityCheckText}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                  <ThemedText type="body" style={{ color: theme.text }}>
                                    {finding.title}
                                  </ThemedText>
                                  {finding.isHeuristic ? (
                                    <View style={[styles.kindBadge, { backgroundColor: theme.accent + "15" }]}>
                                      <ThemedText type="caption" style={{ color: theme.accent, fontSize: 9 }}>
                                        Heuristic
                                      </ThemedText>
                                    </View>
                                  ) : null}
                                </View>
                                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                                  {finding.summary}
                                </ThemedText>
                              </View>
                            </View>
                            {isProgram ? (
                              <View style={[styles.securityPill, { backgroundColor: theme.accent + "20" }]}>
                                <ThemedText type="small" style={{ color: theme.accent, fontWeight: "600" }}>
                                  {finding.summary.includes("Token-2022") ? "Token-2022" : "SPL"}
                                </ThemedText>
                              </View>
                            ) : (
                              <View style={[styles.securityPill, { backgroundColor: color + "20" }]}>
                                <ThemedText type="small" style={{ color, fontWeight: "600" }}>
                                  {badgeText}
                                </ThemedText>
                              </View>
                            )}
                          </View>
                        );
                      })}
                      <View style={[styles.securityFooter, { borderTopWidth: 1, borderTopColor: theme.border }]}>
                        <ThemedText type="caption" style={{ color: theme.textSecondary, fontStyle: "italic" }}>
                          Verified = on-chain facts. Heuristics = patterns, not guarantees.
                        </ThemedText>
                      </View>
                    </>
                  ) : null}
                </View>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: headerHeight + Spacing.sm, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.pnlCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.pnlCardHeader}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Profit / Loss
            </ThemedText>
          </View>
          
          <View style={styles.pnlValueRow}>
            <ThemedText
              type="h2"
              style={{
                color: totalPnl >= 0 ? "#22C55E" : "#EF4444",
                fontSize: 28,
                fontWeight: "700",
              }}
            >
              {totalPnl >= 0 ? "+" : ""}${Math.abs(totalPnl).toFixed(2)}
            </ThemedText>
            <View style={[styles.pnlBadge, { backgroundColor: totalPnl >= 0 ? "#22C55E15" : "#EF444415" }]}>
              <ThemedText
                type="small"
                style={{
                  color: totalPnl >= 0 ? "#22C55E" : "#EF4444",
                  fontSize: 12,
                }}
              >
                {pnlPercent >= 0 ? "+" : ""}{pnlPercent.toFixed(2)}%
              </ThemedText>
            </View>
          </View>

          {pnlData.length >= 2 ? (
            <PnlChart data={pnlData} height={120} />
          ) : (
            <View style={styles.chartPlaceholderSmall}>
              <Feather name="trending-up" size={18} color={theme.textSecondary} />
              <ThemedText type="small" style={{ color: theme.textSecondary, marginLeft: 6 }}>
                Loading price data...
              </ThemedText>
            </View>
          )}
        </View>

        <View style={{ marginBottom: Spacing.lg }}>
          <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.sm }}>
            Price Chart
          </ThemedText>
          <PriceChart symbol={tokenSymbol} currentPrice={priceUsd} chainId={chainId} tokenAddress={address} />
        </View>

        <View style={[styles.tabsContainer, { borderBottomColor: theme.border }]}>
          {tabs.map((tab) => (
            <Pressable
              key={tab.key}
              style={[
                styles.tab,
                activeTab === tab.key && { borderBottomColor: theme.accent, borderBottomWidth: 2 },
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <ThemedText
                type="body"
                style={{
                  color: activeTab === tab.key ? theme.text : theme.textSecondary,
                  fontWeight: activeTab === tab.key ? "600" : "400",
                }}
              >
                {tab.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {activeTab === "holdings" && renderHoldingsTab()}
        {activeTab === "history" && renderHistoryTab()}
        {activeTab === "about" && renderAboutTab()}
      </ScrollView>

      <View style={[styles.bottomActions, { backgroundColor: theme.backgroundRoot, paddingBottom: insets.bottom + Spacing.md }]}>
        <Pressable
          style={[styles.bottomButton, { backgroundColor: theme.accent + "20" }]}
          onPress={() => navigation.navigate("Send", { 
            tokenSymbol,
            presetAsset: {
              symbol: tokenSymbol,
              name: tokenName,
              chainType: route.params.chainType || (chainId === 0 ? "solana" : "evm"),
              chainId: chainId,
              decimals: decimals,
              balance: String(balance),
              priceUsd: priceUsd,
              isNative: isNative,
              address: route.params.chainType === "solana" ? undefined : address,
              mint: route.params.chainType === "solana" ? address : undefined,
              logoUrl: tokenLogoUrl || undefined,
            },
          })}
        >
          <Feather name="arrow-up-right" size={20} color={theme.accent} />
          <ThemedText type="small" style={{ color: theme.accent }}>Send</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.bottomButton, { backgroundColor: theme.success + "20" }]}
          onPress={() => activeWallet && navigation.navigate("Receive", { 
            walletAddress: activeWallet.addresses?.evm || activeWallet.address,
            solanaAddress: activeWallet.addresses?.solana,
            preselectedToken: {
              symbol: tokenSymbol,
              name: tokenName,
              chainType: route.params.chainType || "evm",
              chainId: chainId,
              chainName: chainName,
              logoUrl: tokenLogoUrl || undefined,
              address: address,
              mint: route.params.chainType === "solana" ? address : undefined,
            },
          })}
        >
          <Feather name="arrow-down-left" size={20} color={theme.success} />
          <ThemedText type="small" style={{ color: theme.success }}>Receive</ThemedText>
        </Pressable>
        <Pressable 
          style={[styles.bottomButton, { backgroundColor: theme.warning + "20" }]}
          onPress={() => {
            // Only Solana tokens can be swapped
            if (route.params.chainType === "solana") {
              // For native SOL, use the wrapped SOL mint address
              const SOL_MINT = "So11111111111111111111111111111111111111112";
              const mintAddress = isNative ? SOL_MINT : (address || "");
              navigation.navigate("Swap", {
                preselectedToken: {
                  mint: mintAddress,
                  symbol: tokenSymbol,
                  name: tokenName,
                  decimals: decimals,
                  logoURI: tokenLogoUrl || undefined,
                },
              });
            } else {
              // For EVM tokens, just open swap without preselection
              navigation.navigate("Swap", {});
            }
          }}
        >
          <Feather name="repeat" size={20} color={theme.warning} />
          <ThemedText type="small" style={{ color: theme.warning }}>Swap</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

function getDefaultDescription(symbol: string, chainName: string): string {
  const descriptions: Record<string, string> = {
    ETH: "Ethereum is a decentralized blockchain platform that enables smart contracts and decentralized applications (dApps). It is the second-largest cryptocurrency by market capitalization.",
    POL: "POL (formerly MATIC) is the native token of Polygon, a Layer 2 scaling solution for Ethereum that provides faster and cheaper transactions while maintaining security through the Ethereum mainnet.",
    BNB: "BNB is the native cryptocurrency of the BNB Chain ecosystem, used for transaction fees, staking, and participating in token sales on the Binance Launchpad.",
    USDC: "USD Coin (USDC) is a stablecoin pegged 1:1 to the US Dollar, backed by fully reserved assets and regularly audited to ensure transparency.",
    USDT: "Tether (USDT) is the world's largest stablecoin by market cap, designed to maintain a stable value equivalent to the US Dollar.",
    DAI: "DAI is a decentralized stablecoin soft-pegged to the US Dollar, created and maintained by the MakerDAO protocol through a system of smart contracts.",
    WBTC: "Wrapped Bitcoin (WBTC) is an ERC-20 token backed 1:1 by Bitcoin, allowing BTC to be used in Ethereum's DeFi ecosystem.",
  };
  return descriptions[symbol] || `${symbol} is a cryptocurrency token on ${chainName}.`;
}

function getDefaultMarketCap(symbol: string): string {
  const caps: Record<string, string> = {
    ETH: "$372.6B",
    BNB: "$95.2B",
    POL: "$1.5B",
    USDC: "$52.8B",
    USDT: "$139.4B",
  };
  return caps[symbol] || "-";
}

function getTokenLinks(symbol: string, chainId: number, address?: string, tokenInfo?: TokenInfo | null): { label: string; url: string }[] {
  const explorerBaseUrls: Record<number, string> = {
    0: "https://solscan.io",
    1: "https://etherscan.io",
    137: "https://polygonscan.com",
    56: "https://bscscan.com",
  };

  const fallbackSites: Record<string, string> = {
    SOL: "https://solana.com",
    ETH: "https://ethereum.org",
    POL: "https://polygon.technology",
    BNB: "https://www.bnbchain.org",
    USDC: "https://www.circle.com/usdc",
    USDT: "https://tether.to",
    DAI: "https://makerdao.com",
  };

  const links: { label: string; url: string }[] = [];
  
  const website = tokenInfo?.website || fallbackSites[symbol];
  if (website) {
    links.push({ label: "Official website", url: website });
  }

  // Handle Solana (chainId 0)
  if (chainId === 0) {
    if (address) {
      // SPL token - link to token address on Solscan
      links.push({ label: "Explorer", url: `https://solscan.io/token/${address}` });
    } else if (symbol === "SOL") {
      // Native SOL - link to Solana homepage on Solscan
      links.push({ label: "Explorer", url: "https://solscan.io" });
    }
  } else {
    // EVM chains
    const explorerBase = explorerBaseUrls[chainId] || "https://etherscan.io";
    if (address) {
      links.push({ label: "Explorer", url: `${explorerBase}/token/${address}` });
    } else {
      links.push({ label: "Explorer", url: explorerBase });
    }
  }

  if (tokenInfo?.twitter) {
    links.push({ label: "X", url: tokenInfo.twitter });
  }

  return links;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.sm,
  },
  navHeaderTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  navTokenIcon: {
    width: 28,
    height: 28,
    borderRadius: BorderRadius.xs,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  navTokenLogo: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  navChainPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  pnlCard: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  pnlCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  priceChip: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BorderRadius.xs,
  },
  pnlValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: Spacing.sm,
  },
  pnlBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BorderRadius.xs,
  },
  chartPlaceholderSmall: {
    height: 80,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    width: "100%",
    marginBottom: Spacing.md,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  tokenIcon: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  headerInfo: {
    gap: Spacing.xs,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  chainBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  priceSection: {
    alignItems: "center",
    gap: Spacing.sm,
  },
  priceChange: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  tabsContainer: {
    flexDirection: "row",
    borderBottomWidth: 1,
    marginBottom: Spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: "center",
  },
  tabContent: {
    gap: Spacing.md,
  },
  holdingCard: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  holdingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
  },
  holdingChain: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  chainDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  holdingTokenLogo: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  holdingValues: {
    alignItems: "flex-end",
    gap: Spacing.xs,
  },
  pnlRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
  },
  pnlHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  chartPlaceholder: {
    height: 140,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  txRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  txIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  txInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  txAmount: {
    alignItems: "flex-end",
    gap: Spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  securityPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.xs,
  },
  securityHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  securityHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  securityCheckRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.md,
  },
  securityCheckLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
    flex: 1,
  },
  securityCheckText: {
    flex: 1,
    gap: 2,
  },
  kindBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: BorderRadius.xs,
  },
  rescanButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.sm,
  },
  securityFooter: {
    padding: Spacing.md,
  },
  aboutSection: {
    marginBottom: Spacing.xl,
  },
  statsCard: {
    borderRadius: BorderRadius.md,
    overflow: "hidden",
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.lg,
  },
  linksRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  linkButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  bottomActions: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  bottomButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  pnlHeroSection: {
    alignSelf: "stretch",
    marginBottom: Spacing.md,
  },
  pnlHeroHeader: {
    alignItems: "flex-start",
    marginBottom: Spacing.xs,
  },
  priceStatsRow: {
    flexDirection: "row",
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    width: "100%",
  },
  priceStat: {
    flex: 1,
    alignItems: "center",
    gap: Spacing.xs,
  },
  priceStatDivider: {
    width: 1,
    height: "100%",
  },
  headerCompact: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  tokenIconSmall: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  chainPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  pnlBadgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  chartPlaceholderCompact: {
    height: 100,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  priceStatsCompact: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignSelf: "stretch",
  },
  priceStatCompact: {
    alignItems: "center",
    gap: 2,
  },
});
