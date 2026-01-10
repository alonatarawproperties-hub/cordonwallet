import { useState, useCallback } from "react";
import { View, StyleSheet, SectionList, Pressable, RefreshControl } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as WebBrowser from "expo-web-browser";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { useWallet } from "@/lib/wallet-context";
import { TxRecord, ActivityType, getTransactionsByWallet } from "@/lib/transaction-history";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  fetchAllChainsHistory,
  groupTransactionsByDate,
} from "@/lib/blockchain/explorer-api";
import { supportedChains, getChainById, getExplorerAddressUrl } from "@/lib/blockchain/chains";
import { NetworkId } from "@/lib/types";
import { getApiUrl } from "@/lib/query-client";
import { getCustomTokens, CustomToken } from "@/lib/token-preferences";

const NETWORK_TO_CHAIN_ID: Record<NetworkId, number> = {
  ethereum: 1,
  polygon: 137,
  bsc: 56,
  solana: 0,
};

interface SolanaApiTransaction {
  signature: string;
  blockTime: number | null;
  slot: number;
  err: any;
  type: "send" | "receive" | "unknown";
  amount?: string;
  tokenSymbol?: string;
  tokenMint?: string;
  from?: string;
  to?: string;
}

async function fetchSolanaHistory(
  address: string,
  customTokens: CustomToken[]
): Promise<TxRecord[]> {
  try {
    const apiUrl = getApiUrl();
    const url = new URL(`/api/solana/history/${address}`, apiUrl);
    url.searchParams.set("limit", "30");
    
    const response = await fetch(url.toString());
    if (!response.ok) return [];
    
    const transactions: SolanaApiTransaction[] = await response.json();
    
    const getTokenSymbol = (tx: SolanaApiTransaction): string => {
      if (tx.tokenSymbol) return tx.tokenSymbol;
      if (!tx.tokenMint) return "SOL";
      
      const customToken = customTokens.find(
        t => t.chainId === 0 && 
             t.contractAddress.toLowerCase() === tx.tokenMint?.toLowerCase()
      );
      return customToken?.symbol || tx.tokenMint.slice(0, 4).toUpperCase();
    };
    
    return transactions
      .filter(tx => tx.type !== "unknown")
      .map(tx => ({
        id: tx.signature,
        chainId: 0,
        walletAddress: address,
        hash: tx.signature,
        type: tx.tokenMint ? "spl" : "native",
        activityType: tx.type as ActivityType,
        tokenAddress: tx.tokenMint,
        tokenSymbol: getTokenSymbol(tx),
        to: tx.to || "",
        from: tx.from,
        amount: tx.amount || "0",
        status: tx.err ? "failed" : "confirmed",
        createdAt: tx.blockTime ? tx.blockTime * 1000 : Date.now(),
        explorerUrl: `https://solscan.io/tx/${tx.signature}`,
      } as TxRecord));
  } catch (error) {
    console.error("[Activity] Failed to fetch Solana history:", error);
    return [];
  }
}

type NetworkFilter = "all" | number;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

async function fetchPrices(): Promise<Record<string, number>> {
  try {
    const apiUrl = getApiUrl();
    const priceUrl = new URL("/api/prices", apiUrl);
    const response = await fetch(priceUrl.toString());
    if (!response.ok) return {};
    
    const data = await response.json();
    const prices: Record<string, number> = {};
    
    for (const [symbol, value] of Object.entries(data)) {
      if (typeof value === "number") {
        prices[symbol.toUpperCase()] = value;
      } else if (value && typeof value === "object" && "price" in value) {
        prices[symbol.toUpperCase()] = (value as { price: number }).price;
      }
    }
    return prices;
  } catch {
    return {};
  }
}

async function fetchTokenPrices(
  mintAddresses: string[],
  customTokens: CustomToken[]
): Promise<Record<string, number>> {
  if (mintAddresses.length === 0) return {};
  
  const prices: Record<string, number> = {};
  const apiUrl = getApiUrl();
  
  for (const mint of mintAddresses) {
    try {
      const url = new URL(`/api/dexscreener/token/solana/${mint}`, apiUrl);
      const response = await fetch(url.toString());
      if (!response.ok) continue;
      
      const data = await response.json();
      if (data.priceUsd) {
        prices[mint] = parseFloat(data.priceUsd);
        const token = customTokens.find(
          t => t.chainId === 0 && t.contractAddress.toLowerCase() === mint.toLowerCase()
        );
        if (token) {
          prices[token.symbol.toUpperCase()] = parseFloat(data.priceUsd);
        }
      }
    } catch {
      continue;
    }
  }
  
  return prices;
}

export default function ActivityScreen() {
  const navigation = useNavigation<NavigationProp>();
  const headerHeight = useHeaderHeight();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { activeWallet, selectedNetwork } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<TxRecord[]>([]);
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>("all");
  const [showNetworkPicker, setShowNetworkPicker] = useState(false);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);

  const loadTransactions = useCallback(async () => {
    if (!activeWallet) {
      console.log("[Activity] No active wallet");
      setTransactions([]);
      setLoading(false);
      return;
    }

    const evmAddress = activeWallet.addresses?.evm || activeWallet.address || "";
    const solanaAddress = activeWallet.addresses?.solana || "";
    const isSolanaOnly = activeWallet.walletType === "solana-only";

    console.log("[Activity] Loading transactions for EVM:", evmAddress?.slice(0, 8), "Solana:", solanaAddress?.slice(0, 8));

    try {
      const tokens = await getCustomTokens();
      setCustomTokens(tokens);
      
      const fetchPromises: Promise<TxRecord[]>[] = [];

      if (!isSolanaOnly && evmAddress) {
        fetchPromises.push(fetchAllChainsHistory(evmAddress));
        fetchPromises.push(getTransactionsByWallet(evmAddress));
      }

      if (solanaAddress) {
        fetchPromises.push(fetchSolanaHistory(solanaAddress, tokens));
      }

      const [txResults, priceData] = await Promise.all([
        Promise.all(fetchPromises),
        fetchPrices(),
      ]);
      
      let explorerTxs: TxRecord[] = [];
      let localTxs: TxRecord[] = [];
      let solanaTxs: TxRecord[] = [];

      if (!isSolanaOnly && evmAddress) {
        explorerTxs = txResults[0] || [];
        localTxs = txResults[1] || [];
        solanaTxs = solanaAddress ? (txResults[2] || []) : [];
      } else if (solanaAddress) {
        solanaTxs = txResults[0] || [];
      }

      console.log("[Activity] EVM Explorer txs:", explorerTxs.length, "Local txs:", localTxs.length, "Solana txs:", solanaTxs.length);

      const explorerHashes = new Set(explorerTxs.map((tx) => tx.hash.toLowerCase()));
      const uniqueLocalTxs = localTxs.filter(
        (tx) => !explorerHashes.has(tx.hash.toLowerCase())
      );

      const allTxs = [...uniqueLocalTxs, ...explorerTxs, ...solanaTxs];
      allTxs.sort((a, b) => b.createdAt - a.createdAt);

      console.log("[Activity] Total transactions:", allTxs.length);
      setTransactions(allTxs.slice(0, 100));
      
      const uniqueMints = new Set<string>();
      solanaTxs.forEach(tx => {
        if (tx.tokenAddress) uniqueMints.add(tx.tokenAddress);
      });
      
      const tokenPrices = await fetchTokenPrices(Array.from(uniqueMints), tokens);
      setPrices({ ...priceData, ...tokenPrices });
    } catch (error) {
      console.error("[Activity] Failed to load transactions:", error);
      const evmAddr = activeWallet.addresses?.evm || activeWallet.address || "";
      const localTxs = evmAddr ? await getTransactionsByWallet(evmAddr) : [];
      setTransactions(localTxs);
    } finally {
      setLoading(false);
    }
  }, [activeWallet]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadTransactions();
    }, [loadTransactions])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTransactions();
    setRefreshing(false);
  }, [loadTransactions]);

  const filteredTransactions =
    networkFilter === "all"
      ? transactions
      : transactions.filter((tx) => tx.chainId === networkFilter);

  const groupedData = groupTransactionsByDate(filteredTransactions);

  const getActivityIcon = (activityType: ActivityType): keyof typeof Feather.glyphMap => {
    switch (activityType) {
      case "send":
        return "arrow-up";
      case "receive":
        return "arrow-down";
      case "swap":
        return "repeat";
    }
  };

  const getActivityColor = (activityType: ActivityType) => {
    switch (activityType) {
      case "send":
        return theme.text;
      case "receive":
        return theme.success;
      case "swap":
        return theme.warning;
    }
  };

  const getActivityLabel = (activityType: ActivityType) => {
    switch (activityType) {
      case "send":
        return "Send";
      case "receive":
        return "Receive";
      case "swap":
        return "Swap";
    }
  };

  const handleTransactionPress = (tx: TxRecord) => {
    navigation.navigate("TransactionDetail", {
      hash: tx.hash,
      chainId: tx.chainId,
      activityType: tx.activityType,
      tokenSymbol: tx.tokenSymbol,
      amount: tx.amount,
      to: tx.to,
      from: tx.from,
      status: tx.status,
      createdAt: tx.createdAt,
      explorerUrl: tx.explorerUrl,
    });
  };

  const handleCheckExplorer = async () => {
    if (!activeWallet) return;
    const chainId = networkFilter === "all" 
      ? NETWORK_TO_CHAIN_ID[selectedNetwork] 
      : networkFilter;
    const url = getExplorerAddressUrl(chainId, activeWallet.address);
    if (url) {
      await WebBrowser.openBrowserAsync(url);
    }
  };

  const getNetworkName = (filter: NetworkFilter) => {
    if (filter === "all") return "All networks";
    if (filter === 0) return "Solana";
    const chain = getChainById(filter);
    return chain?.name || "Unknown";
  };

  const getChainName = (chainId: number): string => {
    if (chainId === 0) return "Solana";
    const chain = getChainById(chainId);
    return chain?.name || "Unknown";
  };

  const renderTransaction = ({ item }: { item: TxRecord }) => {
    const activityType = item.activityType || "send";
    const activityIcon = getActivityIcon(activityType);
    const activityLabel = getActivityLabel(activityType);
    const chainName = getChainName(item.chainId);

    const getSubtitle = () => {
      if (activityType === "send") {
        const truncatedTo = `${item.to.slice(0, 8)}...${item.to.slice(-6)}`;
        return `To: ${truncatedTo}`;
      } else if (activityType === "receive" && item.from) {
        const truncatedFrom = `${item.from.slice(0, 8)}...${item.from.slice(-6)}`;
        return `From: ${truncatedFrom}`;
      } else if (activityType === "swap" && item.toTokenSymbol) {
        return `${item.tokenSymbol} → ${item.toTokenSymbol}`;
      }
      return "";
    };

    const getAmountDisplay = () => {
      if (activityType === "send") {
        return `-${item.amount} ${item.tokenSymbol}`;
      } else if (activityType === "receive") {
        return `+${item.amount} ${item.tokenSymbol}`;
      } else if (activityType === "swap" && item.toAmount && item.toTokenSymbol) {
        return `+${item.toAmount} ${item.toTokenSymbol}`;
      }
      return `${item.amount} ${item.tokenSymbol}`;
    };

    const getUsdValue = (): string | null => {
      const amount = parseFloat(item.amount);
      if (isNaN(amount) || amount === 0) return null;
      
      let price = prices[item.tokenSymbol.toUpperCase()];
      if (!price && item.tokenAddress) {
        price = prices[item.tokenAddress];
      }
      
      if (!price) return null;
      
      const usdValue = amount * price;
      if (usdValue < 0.01) {
        return `$${usdValue.toFixed(4)}`;
      }
      return `$${usdValue.toFixed(2)}`;
    };

    const amountColor =
      activityType === "receive"
        ? theme.success
        : activityType === "send"
        ? theme.text
        : theme.warning;

    const usdValue = getUsdValue();

    return (
      <Pressable
        style={styles.transactionRow}
        onPress={() => handleTransactionPress(item)}
      >
        <View style={[styles.txIcon, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name={activityIcon} size={18} color={theme.text} />
        </View>
        <View style={styles.txInfo}>
          <View style={styles.txHeader}>
            <ThemedText type="body" style={{ fontWeight: "600" }}>
              {activityLabel}
            </ThemedText>
            {item.status === "confirmed" ? (
              <View style={[styles.statusDot, { backgroundColor: theme.success }]} />
            ) : item.status === "pending" ? (
              <Badge label="Pending" variant="warning" />
            ) : (
              <Badge label="Failed" variant="danger" />
            )}
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {getSubtitle()}
          </ThemedText>
        </View>
        <View style={styles.txAmount}>
          <ThemedText
            type="body"
            style={{
              fontWeight: "600",
              textAlign: "right",
              color: amountColor,
            }}
          >
            {getAmountDisplay()}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "right" }}>
            {usdValue ? `≈ ${usdValue}` : chainName}
          </ThemedText>
        </View>
      </Pressable>
    );
  };

  const renderSectionHeader = ({ section }: { section: { title: string } }) => (
    <ThemedText type="caption" style={[styles.sectionHeader, { color: theme.textSecondary }]}>
      {section.title}
    </ThemedText>
  );

  if (!activeWallet) {
    return (
      <ThemedView style={styles.container}>
        <EmptyState title="No Wallet" message="Create or import a wallet to see activity" />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: headerHeight + Spacing.md }]}>
        <Pressable
          style={[styles.networkFilter, { backgroundColor: theme.backgroundDefault }]}
          onPress={() => setShowNetworkPicker(!showNetworkPicker)}
        >
          <ThemedText type="caption" style={{ fontWeight: "600" }}>
            {getNetworkName(networkFilter)}
          </ThemedText>
          <Feather name="chevron-down" size={14} color={theme.text} />
        </Pressable>

        {showNetworkPicker ? (
          <View style={[styles.networkDropdown, { backgroundColor: theme.backgroundDefault }]}>
            <Pressable
              style={styles.networkOption}
              onPress={() => {
                setNetworkFilter("all");
                setShowNetworkPicker(false);
              }}
            >
              <ThemedText type="body">All networks</ThemedText>
              {networkFilter === "all" ? (
                <Feather name="check" size={16} color={theme.accent} />
              ) : null}
            </Pressable>
            {supportedChains.map((chain) => (
              <Pressable
                key={chain.chainId}
                style={styles.networkOption}
                onPress={() => {
                  setNetworkFilter(chain.chainId);
                  setShowNetworkPicker(false);
                }}
              >
                <ThemedText type="body">{chain.name}</ThemedText>
                {networkFilter === chain.chainId ? (
                  <Feather name="check" size={16} color={theme.accent} />
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <Pressable
        style={[styles.explorerBanner, { backgroundColor: theme.backgroundDefault }]}
        onPress={handleCheckExplorer}
      >
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Can't find your transaction?{" "}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.accent, fontWeight: "600" }}>
          Check explorer
        </ThemedText>
      </Pressable>

      <SectionList
        style={styles.list}
        contentContainerStyle={{
          paddingBottom: tabBarHeight + Spacing.xl,
          paddingHorizontal: Spacing.lg,
          flexGrow: 1,
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        sections={groupedData}
        keyExtractor={(item) => item.id}
        renderItem={renderTransaction}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              image={require("../../assets/images/empty-activity.png")}
              title="No Activity Yet"
              message="Your sends, receives, and swaps will appear here"
            />
          )
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    zIndex: 10,
  },
  networkFilter: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
  },
  networkDropdown: {
    position: "absolute",
    top: "100%",
    left: Spacing.lg,
    marginTop: Spacing.xs,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    minWidth: 160,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  networkOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  explorerBanner: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  list: {
    flex: 1,
  },
  sectionHeader: {
    paddingVertical: Spacing.md,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  transactionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  txIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  txInfo: {
    flex: 1,
    gap: 2,
  },
  txHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  txAmount: {
    alignItems: "flex-end",
    gap: 2,
  },
});
