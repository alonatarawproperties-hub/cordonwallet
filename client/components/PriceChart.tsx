import { useState, useEffect } from "react";
import { View, StyleSheet, Dimensions, Pressable, ActivityIndicator } from "react-native";
import Svg, { Path, Circle, Defs, LinearGradient, Stop, Line } from "react-native-svg";
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

export function PriceChart({ symbol, currentPrice, width: propWidth, height = 200 }: PriceChartProps) {
  const { theme } = useTheme();
  const screenWidth = Dimensions.get("window").width;
  // Account for all parent padding: scrollContent (Spacing.sm * 2) + container padding (Spacing.md * 2) + extra buffer
  const width = propWidth || screenWidth - (Spacing.sm * 2) - (Spacing.md * 2) - Spacing.md;
  const padding = { top: 30, right: 20, bottom: 50, left: 25 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const [selectedRange, setSelectedRange] = useState<TimeRange>("1W");
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchChartData();
  }, [symbol, selectedRange]);

  const fetchChartData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const days = TIME_RANGES.find(r => r.label === selectedRange)?.days || "7";
      const baseUrl = getApiUrl();
      const url = new URL(`/api/market-chart/${symbol}?days=${days}`, baseUrl);
      
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
      const prices: [number, number][] = data.prices || [];
      
      const sampledData = sampleData(prices, 60);
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
    return data.filter((_, index) => index % step === 0);
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { height, backgroundColor: theme.backgroundDefault }]}>
        <ActivityIndicator size="small" color={theme.accent} />
      </View>
    );
  }

  if (error || chartData.length < 2) {
    return (
      <View style={[styles.container, { height, backgroundColor: theme.backgroundDefault }]}>
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

  const getX = (index: number) => padding.left + (index / (chartData.length - 1)) * chartWidth;
  const getY = (price: number) => padding.top + chartHeight - ((price - minPrice) / priceRange) * chartHeight;

  const pathPoints = chartData.map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.price)}`).join(" ");
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

  const displayPrice = hoveredIndex !== null ? chartData[hoveredIndex].price : lastPrice;
  const displayChange = hoveredIndex !== null
    ? ((chartData[hoveredIndex].price - firstPrice) / firstPrice) * 100
    : priceChange;

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundDefault }]}>
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

      <Svg width={width} height={height - 80}>
        <Defs>
          <LinearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
            <Stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </LinearGradient>
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

        {hoveredIndex !== null ? (
          <>
            <Line
              x1={getX(hoveredIndex)}
              y1={padding.top}
              x2={getX(hoveredIndex)}
              y2={padding.top + chartHeight}
              stroke={theme.textSecondary}
              strokeWidth={1}
              strokeDasharray="4,4"
            />
            <Circle
              cx={getX(hoveredIndex)}
              cy={getY(chartData[hoveredIndex].price)}
              r={6}
              fill={lineColor}
            />
          </>
        ) : (
          <Circle
            cx={getX(chartData.length - 1)}
            cy={getY(lastPrice)}
            r={4}
            fill={lineColor}
          />
        )}
      </Svg>

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
});
