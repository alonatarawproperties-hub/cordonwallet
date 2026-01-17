import { useState, useEffect, useLayoutEffect } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { GlassView } from "expo-glass-effect";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { PnlChart } from "@/components/PnlChart";
import { PriceChart } from "@/components/PriceChart";
import { useWallet } from "@/lib/wallet-context";
import { fetchTransactionHistory } from "@/lib/blockchain/explorer-api";
import { TxRecord, getTransactionsByWallet } from "@/lib/transaction-history";
import { getApiUrl } from "@/lib/query-client";
import { getTokenLogoUrl } from "@/lib/token-logos";
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

function getChainColor(chainName: string): string {
  const colorMap: Record<string, string> = {
    Ethereum: "#627EEA",
    Polygon: "#8247E5",
    "BNB Chain": "#F3BA2F",
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
  } = route.params;
  
  const tokenLogoUrl = logoUrl || getTokenLogoUrl(tokenSymbol);

  const [activeTab, setActiveTab] = useState<TabType>("holdings");
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [pnlData, setPnlData] = useState<{ timestamp: number; value: number }[]>([]);

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
    
    const balanceNum = parseFloat(String(balance)) || 0;
    if (balanceNum <= 0 && transactions.length === 0) return;
    
    const sortedTxs = [...transactions].sort((a, b) => a.createdAt - b.createdAt);
    const dataPoints: { timestamp: number; value: number }[] = [];
    
    let cumulativeTokens = 0;
    let cumulativeCost = 0;
    
    const priceYesterday = priceUsd / (1 + (priceChange24h || 0) / 100);
    
    for (const tx of sortedTxs) {
      const amount = parseFloat(tx.amount) || 0;
      const txPrice = tx.priceUsd || priceYesterday;
      
      if (tx.activityType === "receive") {
        cumulativeTokens += amount;
        cumulativeCost += amount * txPrice;
      } else if (tx.activityType === "send") {
        const avgCost = cumulativeTokens > 0 ? cumulativeCost / cumulativeTokens : 0;
        cumulativeTokens = Math.max(0, cumulativeTokens - amount);
        cumulativeCost = Math.max(0, cumulativeCost - amount * avgCost);
      }
      
      const currentValue = cumulativeTokens * priceUsd;
      const pnl = currentValue - cumulativeCost;
      
      dataPoints.push({
        timestamp: tx.createdAt,
        value: pnl,
      });
    }
    
    if (dataPoints.length > 0) {
      const finalPnl = dataPoints[dataPoints.length - 1].value;
      dataPoints.push({
        timestamp: Date.now(),
        value: finalPnl,
      });
    } else if (balanceNum > 0) {
      const now = Date.now();
      const yesterday = now - 24 * 60 * 60 * 1000;
      const currentValue = balanceNum * priceUsd;
      const valueYesterday = balanceNum * priceYesterday;
      const pnl24h = currentValue - valueYesterday;
      
      dataPoints.push({ timestamp: yesterday, value: 0 });
      dataPoints.push({ timestamp: now, value: pnl24h });
    }
    
    setPnlData(dataPoints);
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
                  if (isNative && tx.tokenSymbol === "SOL") return true;
                  if (!isNative && address && tx.tokenMint === address) return true;
                  if (!isNative && tx.tokenSymbol === tokenSymbol) return true;
                  return false;
                })
                .map((tx: any) => ({
                  id: tx.signature,
                  hash: tx.signature,
                  chainId: 0,
                  activityType: tx.type === "send" ? "send" : tx.type === "receive" ? "receive" : "send",
                  tokenSymbol: tx.tokenSymbol || tokenSymbol,
                  tokenAddress: tx.tokenMint || address,
                  amount: tx.amount || "0",
                  from: tx.from || "",
                  to: tx.to || "",
                  status: tx.err ? "failed" : "confirmed",
                  createdAt: tx.blockTime ? tx.blockTime * 1000 : Date.now(),
                  explorerUrl: `https://solscan.io/tx/${tx.signature}`,
                } as TxRecord));
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
        allTxs = history.filter(tx => tx.tokenSymbol === tokenSymbol);
      }
      
      setTransactions(allTxs);
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

  const change24hValue = priceUsd && priceChange24h
    ? (priceUsd * priceChange24h) / 100
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
  const balanceNum = parseFloat(String(balance)) || 0;
  const currentValue = balanceNum * (priceUsd || 0);
  const costBasis = currentValue - totalPnl;
  const pnlPercent = costBasis > 0 ? (totalPnl / costBasis) * 100 : (transactions.length > 0 ? 0 : priceChange24h || 0);

  const renderHoldingsTab = () => (
    <View style={styles.tabContent}>
      <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
        My Balance
      </ThemedText>
      <View style={[styles.holdingCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.holdingRow}>
          <View style={styles.holdingChain}>
            <View style={[styles.chainDot, { backgroundColor: getChainColor(chainName) }]} />
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
        transactions.map((tx) => (
          <Pressable
            key={tx.id}
            style={[styles.txRow, { backgroundColor: theme.backgroundDefault }]}
            onPress={() => handleTransactionPress(tx)}
          >
            <View
              style={[
                styles.txIcon,
                { backgroundColor: tx.activityType === "receive" ? theme.success + "20" : theme.accent + "20" },
              ]}
            >
              <Feather
                name={tx.activityType === "receive" ? "arrow-down-left" : "arrow-up-right"}
                size={18}
                color={tx.activityType === "receive" ? theme.success : theme.accent}
              />
            </View>
            <View style={styles.txInfo}>
              <ThemedText type="body" style={{ fontWeight: "600" }}>
                {tx.activityType === "receive" ? "Received" : "Sent"}
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
                  color: tx.activityType === "receive" ? theme.success : theme.text,
                  textAlign: "right",
                }}
              >
                {tx.activityType === "receive" ? "+" : "-"}{tx.amount} {tx.tokenSymbol}
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
        ))
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
            <View style={[styles.priceChip, { backgroundColor: theme.border + "30" }]}>
              <ThemedText type="small" style={{ color: theme.textSecondary, fontSize: 11 }}>
                ${priceUsd ? formatPrice(priceUsd) : "0.00"}
              </ThemedText>
              <ThemedText
                type="small"
                style={{
                  fontSize: 11,
                  color: priceChange24h && priceChange24h >= 0 ? "#22C55E" : "#EF4444",
                }}
              >
                {priceChange24h && priceChange24h >= 0 ? "+" : ""}{priceChange24h?.toFixed(2) || 0}%
              </ThemedText>
            </View>
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
          onPress={() => navigation.navigate("Send", { tokenSymbol })}
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
        <Pressable style={[styles.bottomButton, { backgroundColor: theme.warning + "20" }]}>
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
    1: "https://etherscan.io",
    137: "https://polygonscan.com",
    56: "https://bscscan.com",
  };

  const fallbackSites: Record<string, string> = {
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

  const explorerBase = explorerBaseUrls[chainId] || "https://etherscan.io";
  if (address) {
    links.push({ label: "Explorer", url: `${explorerBase}/token/${address}` });
  } else {
    links.push({ label: "Explorer", url: explorerBase });
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
