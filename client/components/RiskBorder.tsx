import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

type RiskLevel = "low" | "medium" | "high";

const RISK_COLORS: Record<RiskLevel, { primary: string; secondary: string }> = {
  low: { primary: "#3B82F6", secondary: "#60A5FA" },
  medium: { primary: "#F59E0B", secondary: "#FBBF24" },
  high: { primary: "#EF4444", secondary: "#F87171" },
};

const BORDER_WIDTH = 4;
const GLOW_SPREAD = 40;

interface RiskBorderProps {
  level: RiskLevel;
  visible: boolean;
}

export function RiskBorder({ level, visible }: RiskBorderProps) {
  const pulseValue = useSharedValue(0);

  useEffect(() => {
    console.log("[RiskBorder] render:", { level, visible });
    if (visible) {
      pulseValue.value = withRepeat(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      pulseValue.value = 0;
    }
  }, [visible, pulseValue]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulseValue.value, [0, 0.5, 1], [0.6, 1, 0.6]),
  }));

  if (!visible) {
    return null;
  }

  const colors = RISK_COLORS[level];

  return (
    <View style={styles.overlayContainer} pointerEvents="box-none">
      <Animated.View style={[styles.overlayFrame, pulseStyle]} pointerEvents="box-none">
        <View style={styles.topBorder} pointerEvents="none">
          <LinearGradient
            colors={[colors.primary, colors.secondary, colors.primary]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
          />
        </View>
        
        <View style={styles.bottomBorder} pointerEvents="none">
          <LinearGradient
            colors={[colors.primary, colors.secondary, colors.primary]}
            style={StyleSheet.absoluteFill}
            start={{ x: 1, y: 0.5 }}
            end={{ x: 0, y: 0.5 }}
          />
        </View>
        
        <View style={styles.leftBorder} pointerEvents="none">
          <LinearGradient
            colors={[colors.primary, colors.secondary, colors.primary]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 1 }}
            end={{ x: 0.5, y: 0 }}
          />
        </View>
        
        <View style={styles.rightBorder} pointerEvents="none">
          <LinearGradient
            colors={[colors.primary, colors.secondary, colors.primary]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
          />
        </View>

        <View style={styles.topGlow} pointerEvents="none">
          <LinearGradient
            colors={[`${colors.primary}80`, `${colors.primary}40`, "transparent"]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
          />
        </View>
        
        <View style={styles.bottomGlow} pointerEvents="none">
          <LinearGradient
            colors={["transparent", `${colors.primary}40`, `${colors.primary}80`]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
          />
        </View>
        
        <View style={styles.leftGlow} pointerEvents="none">
          <LinearGradient
            colors={[`${colors.primary}80`, `${colors.primary}40`, "transparent"]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
          />
        </View>
        
        <View style={styles.rightGlow} pointerEvents="none">
          <LinearGradient
            colors={["transparent", `${colors.primary}40`, `${colors.primary}80`]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  overlayFrame: {
    ...StyleSheet.absoluteFillObject,
  },
  topBorder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: BORDER_WIDTH,
  },
  bottomBorder: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: BORDER_WIDTH,
  },
  leftBorder: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: BORDER_WIDTH,
  },
  rightBorder: {
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
});
