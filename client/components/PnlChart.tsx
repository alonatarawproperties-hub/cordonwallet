import { useState } from "react";
import { View, StyleSheet, LayoutChangeEvent } from "react-native";
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing } from "@/constants/theme";

interface DataPoint {
  timestamp: number;
  value: number;
  label?: string;
}

interface PnlChartProps {
  data: DataPoint[];
  width?: number;
  height?: number;
}

export function PnlChart({ data, width: propWidth, height = 160 }: PnlChartProps) {
  const { theme } = useTheme();
  const [containerWidth, setContainerWidth] = useState<number>(0);
  
  // Use measured container width, or prop width if provided
  const width = propWidth || containerWidth;
  const padding = { top: 20, right: 10, bottom: 30, left: 10 };
  const chartWidth = Math.max(0, width - padding.left - padding.right);
  const chartHeight = height - padding.top - padding.bottom;
  
  const handleLayout = (event: LayoutChangeEvent) => {
    const { width: measuredWidth } = event.nativeEvent.layout;
    // Use the full measured width - padding is already accounted for in the container
    setContainerWidth(measuredWidth);
  };

  if (data.length < 2 || containerWidth === 0) {
    return (
      <View style={[styles.container, { height, backgroundColor: theme.backgroundDefault }]} onLayout={handleLayout}>
        {data.length < 2 ? (
          <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
            Not enough data for chart
          </ThemedText>
        ) : null}
      </View>
    );
  }

  const values = data.map((d) => d.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;

  const getX = (index: number) => padding.left + (index / (data.length - 1)) * chartWidth;
  const getY = (value: number) => padding.top + chartHeight - ((value - minValue) / range) * chartHeight;

  const pathPoints = data.map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.value)}`).join(" ");
  
  const areaPath = `${pathPoints} L ${getX(data.length - 1)} ${padding.top + chartHeight} L ${getX(0)} ${padding.top + chartHeight} Z`;

  const lastValue = data[data.length - 1].value;
  const firstValue = data[0].value;
  const isPositive = lastValue >= firstValue;
  const lineColor = isPositive ? "#22C55E" : "#EF4444";

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundDefault }]} onLayout={handleLayout}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
            <Stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        <Path d={areaPath} fill="url(#areaGradient)" />
        <Path d={pathPoints} stroke={lineColor} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />

        <Circle
          cx={getX(data.length - 1)}
          cy={getY(lastValue)}
          r={4}
          fill={lineColor}
        />
      </Svg>

      <View style={[styles.xLabels, { paddingHorizontal: padding.left }]}>
        <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 10 }}>
          {formatDate(data[0].timestamp)}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 10 }}>
          {formatDate(data[data.length - 1].timestamp)}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    padding: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    alignSelf: "stretch",
    overflow: "hidden",
  },
  xLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginTop: -20,
  },
});
