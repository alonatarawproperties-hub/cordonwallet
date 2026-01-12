import { useEffect, useState } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

import { useSecurityOverlay, RiskLevel } from "@/context/SecurityOverlayContext";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("screen");

const RISK_COLORS: Record<RiskLevel, { primary: string; secondary: string }> = {
  none: { primary: "transparent", secondary: "transparent" },
  low: { primary: "#3B82F6", secondary: "#60A5FA" },
  medium: { primary: "#F59E0B", secondary: "#FBBF24" },
  high: { primary: "#EF4444", secondary: "#F87171" },
};

const BORDER_WIDTH = 3;
const GLOW_SPREAD = 30;

export function RiskAuraOverlay() {
  const { state } = useSecurityOverlay();
  const { isVisible, riskLevel } = state;

  const fadeValue = useSharedValue(0);
  const pulseValue = useSharedValue(0);
  const flowValue = useSharedValue(0);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (isVisible && riskLevel !== "none") {
      setShouldRender(true);
      fadeValue.value = withTiming(1, { duration: 300 });
      pulseValue.value = withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      flowValue.value = withRepeat(
        withTiming(1, { duration: 3000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      fadeValue.value = withTiming(0, { duration: 200 }, (finished) => {
        "worklet";
        if (finished) {
          runOnJS(setShouldRender)(false);
        }
      });
    }
  }, [isVisible, riskLevel, fadeValue, pulseValue, flowValue]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: fadeValue.value,
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulseValue.value, [0, 0.5, 1], [0.4, 0.8, 0.4]),
    transform: [{ scale: interpolate(pulseValue.value, [0, 0.5, 1], [1, 1.02, 1]) }],
  }));

  if (!shouldRender) return null;

  const colors = RISK_COLORS[riskLevel];

  return (
    <Animated.View style={[styles.container, containerStyle]} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, pulseStyle]}>
        <View style={[styles.topEdge, { backgroundColor: colors.primary }]}>
          <LinearGradient
            colors={[colors.primary, colors.secondary, colors.primary]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
          />
        </View>
        <View style={[styles.bottomEdge, { backgroundColor: colors.primary }]}>
          <LinearGradient
            colors={[colors.primary, colors.secondary, colors.primary]}
            style={StyleSheet.absoluteFill}
            start={{ x: 1, y: 0.5 }}
            end={{ x: 0, y: 0.5 }}
          />
        </View>
        <View style={[styles.leftEdge, { backgroundColor: colors.primary }]}>
          <LinearGradient
            colors={[colors.primary, colors.secondary, colors.primary]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 1 }}
            end={{ x: 0.5, y: 0 }}
          />
        </View>
        <View style={[styles.rightEdge, { backgroundColor: colors.primary }]}>
          <LinearGradient
            colors={[colors.primary, colors.secondary, colors.primary]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
          />
        </View>

        <View style={styles.topGlow}>
          <LinearGradient
            colors={[`${colors.primary}60`, "transparent"]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
          />
        </View>
        <View style={styles.bottomGlow}>
          <LinearGradient
            colors={["transparent", `${colors.primary}60`]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
          />
        </View>
        <View style={styles.leftGlow}>
          <LinearGradient
            colors={[`${colors.primary}60`, "transparent"]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
          />
        </View>
        <View style={styles.rightGlow}>
          <LinearGradient
            colors={["transparent", `${colors.primary}60`]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
          />
        </View>

        <View style={[styles.cornerTL, { borderTopColor: colors.primary, borderLeftColor: colors.primary }]} />
        <View style={[styles.cornerTR, { borderTopColor: colors.primary, borderRightColor: colors.primary }]} />
        <View style={[styles.cornerBL, { borderBottomColor: colors.primary, borderLeftColor: colors.primary }]} />
        <View style={[styles.cornerBR, { borderBottomColor: colors.primary, borderRightColor: colors.primary }]} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
  },
  topEdge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: BORDER_WIDTH,
  },
  bottomEdge: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: BORDER_WIDTH,
  },
  leftEdge: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: BORDER_WIDTH,
  },
  rightEdge: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: BORDER_WIDTH,
  },
  topGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: GLOW_SPREAD,
  },
  bottomGlow: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: GLOW_SPREAD,
  },
  leftGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: GLOW_SPREAD,
  },
  rightGlow: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: GLOW_SPREAD,
  },
  cornerTL: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 20,
    height: 20,
    borderTopWidth: BORDER_WIDTH + 1,
    borderLeftWidth: BORDER_WIDTH + 1,
    borderTopLeftRadius: 8,
  },
  cornerTR: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 20,
    height: 20,
    borderTopWidth: BORDER_WIDTH + 1,
    borderRightWidth: BORDER_WIDTH + 1,
    borderTopRightRadius: 8,
  },
  cornerBL: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 20,
    height: 20,
    borderBottomWidth: BORDER_WIDTH + 1,
    borderLeftWidth: BORDER_WIDTH + 1,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderBottomWidth: BORDER_WIDTH + 1,
    borderRightWidth: BORDER_WIDTH + 1,
    borderBottomRightRadius: 8,
  },
});
