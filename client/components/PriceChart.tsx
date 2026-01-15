import { useState, useEffect, useCallback } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator, LayoutChangeEvent, Platform } from "react-native";
import Svg, { Path, Circle, Defs, LinearGradient, Stop, RadialGradient, Rect } from "react-native-svg";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";

type TimeRange = "1D" | "1W" | "1M" | "3M" | "1Y";

interface PriceChartProps {
  symbol: string;
  currentPrice?: number;
  width?: number;
  height?: number;
  chainId?: number;
  tokenAddress?: string;
}

interface ChartData {
  timestamp: number;
  price: number;
}

const TIME_RANGES: { label: TimeRange; days: string }[] = [
  { label: "1D", days: "1" },
  { label: "1W", days: "7" },
  { label: "1M", days: "30" },
  { label: "3M", days: "90" },
  { label: "1Y", days: "365" },
];

export function PriceChart({ symbol, currentPrice, width: propWidth, height = 200, chainId, tokenAddress }: PriceChartProps) {
  const { theme } = useTheme();
  const [chartAreaWidth, setChartAreaWidth] = useState<number>(0);
  
  const svgWidth = propWidth || chartAreaWidth;
  const padding = { top: 20, right: 5, bottom: 40, left: 5 };
  const chartWidth = Math.max(0, svgWidth - padding.left - padding.right);
  const chartHeight = height - padding.top - padding.bottom - 40;

  const [selectedRange, setSelectedRange] = useState<TimeRange>("1W");
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const indicatorX = useSharedValue(0);
  const indicatorY = useSharedValue(0);
  const indicatorOpacity = useSharedValue(0);
  const infoBarOpacity = useSharedValue(0);
  
  const handleChartAreaLayout = (event: LayoutChangeEvent) => {
    const { width: measuredWidth } = event.nativeEvent.layout;
    if (measuredWidth > 0 && measuredWidth !== chartAreaWidth) {
      setChartAreaWidth(measuredWidth);
    }
  };

  useEffect(() => {
    fetchChartData();
  }, [symbol, selectedRange, chainId, tokenAddress]);

  const fetchChartData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const days = TIME_RANGES.find(r => r.label === selectedRange)?.days || "7";
      const baseUrl = getApiUrl();
      const url = new URL(`/api/market-chart/${symbol}?days=${days}`, baseUrl);
      
      if (chainId !== undefined) {
        url.searchParams.set("chainId", chainId === 0 ? "solana" : String(chainId));
      }
      if (tokenAddress) {
        url.searchParams.set("address", tokenAddress);
      }
      
      const response = await fetch(url.toString());
      
      if (!response.ok) {
        if (response.status === 404) {
          setError("Chart not available");
        } else {
          setError("Failed to load chart");
        }
        setChartData([]);
        return;
      }
      
      const data = await response.json();
      const rawPrices: [number, number][] = data.prices || [];
      
      const validPrices = rawPrices.filter(([timestamp, price]) => 
        typeof price === 'number' && Number.isFinite(price) && 
        typeof timestamp === 'number' && Number.isFinite(timestamp)
      );
      
      if (validPrices.length < 2) {
        setError("Not enough data");
        setChartData([]);
        return;
      }
      
      const sampledData = sampleData(validPrices, 60);
      setChartData(sampledData.map(([timestamp, price]) => ({ timestamp, price })));
    } catch (err) {
      console.error("Chart fetch error:", err);
      setError("Failed to load chart");
      setChartData([]);
    } finally {
      setIsLoading(false);
    }
  };

  const sampleData = (data: [number, number][], maxPoints: number): [number, number][] => {
    if (data.length <= maxPoints) return data;
    const step = Math.floor(data.length / maxPoints);
    const sampled = data.filter((_, index) => index % step === 0);
    const lastPoint = data[data.length - 1];
    if (sampled[sampled.length - 1] !== lastPoint) {
      sampled.push(lastPoint);
    }
    return sampled;
  };

  const triggerHaptic = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync();
    }
  }, []);

  const updateActiveIndex = useCallback((index: number | null) => {
    setActiveIndex(index);
  }, []);

  const updateDragging = useCallback((dragging: boolean) => {
    setIsDragging(dragging);
  }, []);

  const getX = useCallback((index: number) => padding.left + (index / (chartData.length - 1)) * chartWidth, [chartData.length, chartWidth, padding.left]);
  const getY = useCallback((price: number, minPrice: number, priceRange: number) => padding.top + chartHeight - ((price - minPrice) / priceRange) * chartHeight, [chartHeight, padding.top]);

  const panGesture = Gesture.Pan()
    .onStart((event) => {
      if (chartData.length < 2) return;
      
      const x = event.x - padding.left;
      const index = Math.round((x / chartWidth) * (chartData.length - 1));
      const clampedIndex = Math.max(0, Math.min(chartData.length - 1, index));
      
      const prices = chartData.map(d => d.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const priceRange = maxPrice - minPrice || 1;
      
      indicatorX.value = getX(clampedIndex);
      indicatorY.value = getY(chartData[clampedIndex].price, minPrice, priceRange);
      indicatorOpacity.value = withSpring(1);
      infoBarOpacity.value = withSpring(1);
      
      runOnJS(updateActiveIndex)(clampedIndex);
      runOnJS(updateDragging)(true);
      runOnJS(triggerHaptic)();
    })
    .onUpdate((event) => {
      if (chartData.length < 2) return;
      
      const x = event.x - padding.left;
      const index = Math.round((x / chartWidth) * (chartData.length - 1));
      const clampedIndex = Math.max(0, Math.min(chartData.length - 1, index));
      
      const prices = chartData.map(d => d.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const priceRange = maxPrice - minPrice || 1;
      
      const newX = getX(clampedIndex);
      const newY = getY(chartData[clampedIndex].price, minPrice, priceRange);
      
      indicatorX.value = newX;
      indicatorY.value = newY;
      
      runOnJS(updateActiveIndex)(clampedIndex);
    })
    .onEnd(() => {
      indicatorOpacity.value = withTiming(0, { duration: 200 });
      infoBarOpacity.value = withTiming(0, { duration: 200 });
      runOnJS(updateActiveIndex)(null);
      runOnJS(updateDragging)(false);
    });

  const indicatorStyle = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left: indicatorX.value - 12,
    top: indicatorY.value - 12,
    opacity: indicatorOpacity.value,
  }));

  const infoBarStyle = useAnimatedStyle(() => ({
    opacity: infoBarOpacity.value,
  }));

  if (isLoading || chartAreaWidth === 0) {
    return (
      <View style={[styles.container, { height, backgroundColor: theme.backgroundDefault }]} onLayout={handleChartAreaLayout}>
        <ActivityIndicator size="small" color={theme.accent} />
      </View>
    );
  }

  if (error || chartData.length < 2) {
    return (
      <View style={[styles.container, { height, backgroundColor: theme.backgroundDefault }]} onLayout={handleChartAreaLayout}>
        <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
          {error || "Not enough data for chart"}
        </ThemedText>
        <View style={styles.rangeContainer}>
          {TIME_RANGES.map(({ label }) => (
            <Pressable
              key={label}
              style={[
                styles.rangeButton,
                { backgroundColor: selectedRange === label ? theme.accent + "20" : "transparent" },
              ]}
              onPress={() => setSelectedRange(label)}
            >
              <ThemedText
                type="small"
                style={{ color: selectedRange === label ? theme.accent : theme.textSecondary }}
              >
                {label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  const prices = chartData.map(d => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  const pathPoints = chartData.map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.price, minPrice, priceRange)}`).join(" ");
  const areaPath = `${pathPoints} L ${getX(chartData.length - 1)} ${padding.top + chartHeight} L ${getX(0)} ${padding.top + chartHeight} Z`;

  const lastPrice = chartData[chartData.length - 1].price;
  const firstPrice = chartData[0].price;
  const priceChange = ((lastPrice - firstPrice) / firstPrice) * 100;
  const isPositive = priceChange >= 0;
  const lineColor = isPositive ? "#22C55E" : "#EF4444";

  const formatPrice = (price: number): string => {
    if (price >= 1000) return `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    if (price >= 1) return `$${price.toFixed(2)}`;
    if (price >= 0.01) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(6)}`;
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    if (selectedRange === "1D") {
      return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const formatFullTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    if (selectedRange === "1D") {
      return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const displayPrice = activeIndex !== null ? chartData[activeIndex].price : lastPrice;
  const displayChange = activeIndex !== null
    ? ((chartData[activeIndex].price - firstPrice) / firstPrice) * 100
    : priceChange;
  const displayChangeAmount = activeIndex !== null
    ? chartData[activeIndex].price - firstPrice
    : lastPrice - firstPrice;

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundDefault }]} onLayout={handleChartAreaLayout}>
      <View style={styles.priceHeader}>
        <ThemedText type="h2" style={{ fontWeight: "700" }}>
          {formatPrice(displayPrice)}
        </ThemedText>
        <ThemedText
          type="body"
          style={{ color: displayChange >= 0 ? "#22C55E" : "#EF4444" }}
        >
          {displayChange >= 0 ? "+" : ""}{displayChange.toFixed(2)}%
        </ThemedText>
      </View>

      <GestureDetector gesture={panGesture}>
        <View style={{ width: svgWidth, height: height - 80 }}>
          <Svg width={svgWidth} height={height - 80}>
            <Defs>
              <LinearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                <Stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </LinearGradient>
              <RadialGradient id="glowGradient" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={lineColor} stopOpacity={0.8} />
                <Stop offset="50%" stopColor={lineColor} stopOpacity={0.3} />
                <Stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </RadialGradient>
            </Defs>

            <Path d={areaPath} fill="url(#priceGradient)" />
            <Path
              d={pathPoints}
              stroke={lineColor}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {!isDragging && (
              <Circle
                cx={getX(chartData.length - 1)}
                cy={getY(lastPrice, minPrice, priceRange)}
                r={4}
                fill={lineColor}
              />
            )}
          </Svg>

          <Animated.View style={indicatorStyle}>
            <View style={[styles.glowIndicator, { backgroundColor: lineColor }]}>
              <View style={[styles.glowInner, { backgroundColor: "#fff" }]} />
            </View>
          </Animated.View>
        </View>
      </GestureDetector>

      {isDragging && activeIndex !== null && (
        <Animated.View style={[styles.infoBar, { backgroundColor: theme.backgroundSecondary + "F0" }, infoBarStyle]}>
          <View style={styles.infoBarContent}>
            <View style={styles.infoBarLeft}>
              <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>
                {formatFullTime(chartData[activeIndex].timestamp)}
              </ThemedText>
            </View>
            <View style={styles.infoBarCenter}>
              <ThemedText type="body" style={{ fontWeight: "600", fontSize: 15 }}>
                {formatPrice(chartData[activeIndex].price)}
              </ThemedText>
            </View>
            <View style={styles.infoBarRight}>
              <ThemedText 
                type="caption" 
                style={{ 
                  color: displayChange >= 0 ? "#22C55E" : "#EF4444",
                  fontSize: 11,
                  fontWeight: "500"
                }}
              >
                {displayChange >= 0 ? "+" : ""}{formatPrice(Math.abs(displayChangeAmount)).replace("$", "")} ({displayChange >= 0 ? "+" : ""}{displayChange.toFixed(2)}%)
              </ThemedText>
            </View>
          </View>
        </Animated.View>
      )}

      <View style={styles.timeLabels}>
        <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 10 }}>
          {formatTime(chartData[0].timestamp)}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 10 }}>
          {formatTime(chartData[chartData.length - 1].timestamp)}
        </ThemedText>
      </View>

      <View style={styles.rangeContainer}>
        {TIME_RANGES.map(({ label }) => (
          <Pressable
            key={label}
            style={[
              styles.rangeButton,
              { backgroundColor: selectedRange === label ? theme.accent + "20" : "transparent" },
            ]}
            onPress={() => setSelectedRange(label)}
          >
            <ThemedText
              type="small"
              style={{
                color: selectedRange === label ? theme.accent : theme.textSecondary,
                fontWeight: selectedRange === label ? "600" : "400",
              }}
            >
              {label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    alignSelf: "stretch",
    overflow: "hidden",
  },
  priceHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.md,
    marginBottom: Spacing.sm,
    alignSelf: "flex-start",
  },
  timeLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    paddingHorizontal: Spacing.sm,
    marginTop: -Spacing.md,
  },
  rangeContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  rangeButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  glowIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  glowInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  infoBar: {
    position: "absolute",
    bottom: 90,
    left: Spacing.md,
    right: Spacing.md,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  infoBarContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  infoBarLeft: {
    flex: 1,
    alignItems: "flex-start",
  },
  infoBarCenter: {
    flex: 1,
    alignItems: "center",
  },
  infoBarRight: {
    flex: 1,
    alignItems: "flex-end",
  },
});
