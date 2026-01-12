import { useEffect } from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "./ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";

type RiskLevel = "low" | "medium" | "high" | "blocked" | "scam";

const RISK_COLORS: Record<RiskLevel, { primary: string; secondary: string }> = {
  low: { primary: "#3B82F6", secondary: "#60A5FA" },
  medium: { primary: "#F59E0B", secondary: "#FBBF24" },
  high: { primary: "#EF4444", secondary: "#F87171" },
  blocked: { primary: "#EF4444", secondary: "#F87171" },
  scam: { primary: "#EF4444", secondary: "#F87171" },
};

interface AnimatedRiskCardProps {
  level: RiskLevel;
  label: string;
  reasons: string[];
  animate?: boolean;
}

const BORDER_WIDTH = 2;
const GLOW_SIZE = 12;

export function AnimatedRiskCard({ level, label, reasons, animate = true }: AnimatedRiskCardProps) {
  const pulseValue = useSharedValue(0);
  const colors = RISK_COLORS[level];

  useEffect(() => {
    if (animate && (level === "high" || level === "scam" || level === "blocked")) {
      pulseValue.value = withRepeat(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      pulseValue.value = 0;
    }
  }, [animate, level, pulseValue]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulseValue.value, [0, 0.5, 1], [0.3, 0.8, 0.3]),
    transform: [{ scale: interpolate(pulseValue.value, [0, 0.5, 1], [1, 1.02, 1]) }],
  }));

  const borderStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulseValue.value, [0, 0.5, 1], [0.6, 1, 0.6]),
  }));

  const isHighRisk = level === "high" || level === "scam" || level === "blocked";

  return (
    <View style={styles.container}>
      {isHighRisk && animate ? (
        <Animated.View style={[styles.glowLayer, glowStyle]}>
          <LinearGradient
            colors={[`${colors.primary}00`, `${colors.primary}40`, `${colors.primary}00`]}
            style={styles.glowGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
        </Animated.View>
      ) : null}

      {isHighRisk && animate ? (
        <Animated.View style={[styles.borderLayer, borderStyle]}>
          <View style={[styles.topBorder, { backgroundColor: colors.primary }]} />
          <View style={[styles.bottomBorder, { backgroundColor: colors.primary }]} />
          <View style={[styles.leftBorder, { backgroundColor: colors.primary }]} />
          <View style={[styles.rightBorder, { backgroundColor: colors.primary }]} />
        </Animated.View>
      ) : null}

      <View style={[
        styles.card, 
        { 
          backgroundColor: colors.primary + "15",
          borderColor: isHighRisk && animate ? "transparent" : colors.primary + "40",
          borderWidth: isHighRisk && animate ? 0 : 1,
        }
      ]}>
        <View style={styles.header}>
          <Feather 
            name={level === "low" ? "check-circle" : "alert-triangle"} 
            size={20} 
            color={colors.primary} 
          />
          <ThemedText type="body" style={{ color: colors.primary, fontWeight: "600" }}>
            {label}
          </ThemedText>
        </View>
        {reasons.map((reason, index) => (
          <ThemedText key={index} type="small" style={{ color: colors.primary }}>
            - {reason}
          </ThemedText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    marginBottom: Spacing.lg,
  },
  glowLayer: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: BorderRadius.md + GLOW_SIZE,
    margin: -GLOW_SIZE,
    overflow: "hidden",
  },
  glowGradient: {
    flex: 1,
    borderRadius: BorderRadius.md + GLOW_SIZE,
  },
  borderLayer: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: BorderRadius.md,
  },
  topBorder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: BORDER_WIDTH,
    borderTopLeftRadius: BorderRadius.md,
    borderTopRightRadius: BorderRadius.md,
  },
  bottomBorder: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: BORDER_WIDTH,
    borderBottomLeftRadius: BorderRadius.md,
    borderBottomRightRadius: BorderRadius.md,
  },
  leftBorder: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: BORDER_WIDTH,
    borderTopLeftRadius: BorderRadius.md,
    borderBottomLeftRadius: BorderRadius.md,
  },
  rightBorder: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: BORDER_WIDTH,
    borderTopRightRadius: BorderRadius.md,
    borderBottomRightRadius: BorderRadius.md,
  },
  card: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
});
