import { useState, useEffect } from "react";
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useWallet } from "@/lib/wallet-context";
import { fetchTransactionHistory } from "@/lib/blockchain/explorer-api";
import { TxRecord } from "@/lib/transaction-history";
import { getApiUrl } from "@/lib/query-client";
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
  } = route.params;

  const [activeTab, setActiveTab] = useState<TabType>("holdings");
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);

  useEffect(() => {
    if (activeTab === "history" && activeWallet && transactions.length === 0) {
      loadTransactionHistory();
    }
  }, [activeTab, activeWallet]);

  useEffect(() => {
    if (activeTab === "about" && !tokenInfo) {
      loadTokenInfo();
    }
  }, [activeTab]);

  const loadTransactionHistory = async () => {
    if (!activeWallet) return;
    setIsLoadingHistory(true);
    try {
      const history = await fetchTransactionHistory(activeWallet.address, chainId);
      const filtered = history.filter(tx => tx.tokenSymbol === tokenSymbol);
      setTransactions(filtered);
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

  const renderHoldingsTab = () => (
    <View style={styles.tabContent}>
      <ThemedText type="body" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
        My Balance
      </ThemedText>
      <View style={[styles.holdingCard, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.holdingRow}>
          <View style={styles.holdingChain}>
            <View style={[styles.chainDot, { backgroundColor: getChainColor(chainName) }]} />
            <ThemedText type="body">{chainName}</ThemedText>
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
          { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={[styles.tokenIcon, { backgroundColor: theme.accent + "20" }]}>
              <ThemedText type="h3" style={{ color: theme.accent }}>
                {tokenSymbol.slice(0, 2)}
              </ThemedText>
            </View>
            <View style={styles.headerInfo}>
              <View style={styles.headerTitleRow}>
                <ThemedText type="h3">{tokenSymbol}</ThemedText>
                <View style={[styles.chainBadge, { backgroundColor: getChainColor(chainName) + "20" }]}>
                  <ThemedText type="caption" style={{ color: getChainColor(chainName), fontSize: 10 }}>
                    {chainName}
                  </ThemedText>
                </View>
              </View>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {isNative ? "COIN" : "TOKEN"} | {chainName}
              </ThemedText>
            </View>
          </View>

          <View style={styles.priceSection}>
            <ThemedText type="h1" style={{ textAlign: "center" }}>
              ${priceUsd ? formatPrice(priceUsd) : "0.00"}
            </ThemedText>
            <View style={styles.priceChange}>
              <Feather
                name={priceChange24h && priceChange24h >= 0 ? "arrow-up" : "arrow-down"}
                size={14}
                color={priceChange24h && priceChange24h >= 0 ? "#22C55E" : "#EF4444"}
              />
              <ThemedText
                type="body"
                style={{
                  color: priceChange24h && priceChange24h >= 0 ? "#22C55E" : "#EF4444",
                }}
              >
                ${Math.abs(change24hValue).toFixed(6)} ({priceChange24h?.toFixed(2) || 0}%)
              </ThemedText>
            </View>
          </View>
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
          onPress={() => activeWallet && navigation.navigate("Receive", { walletAddress: activeWallet.address })}
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
    paddingHorizontal: Spacing.lg,
  },
  header: {
    alignItems: "center",
    marginBottom: Spacing.xl,
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
});
