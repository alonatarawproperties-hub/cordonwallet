import { useEffect } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  interpolate,
  cancelAnimation,
  SharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { useSecurityOverlay, RiskLevel } from "@/context/SecurityOverlayContext";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("screen");

function hexToRgba(color: string, alpha: number): string {
  if (color === "transparent") return "transparent";
  if (color.startsWith("rgba")) return color;
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", `,${alpha})`);
  }
  if (!color.startsWith("#") || color.length < 7) {
    return `rgba(128,128,128,${alpha})`;
  }
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return `rgba(128,128,128,${alpha})`;
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

const RISK_COLORS: Record<RiskLevel, { primary: string; secondary: string; glow: string }> = {
  none: { primary: "transparent", secondary: "transparent", glow: "transparent" },
  low: { primary: "#2E90FF", secondary: "#60A5FA", glow: "rgba(46,144,255,0.25)" },
  medium: { primary: "#FFB020", secondary: "#FBBF24", glow: "rgba(255,176,32,0.35)" },
  high: { primary: "#FF3B30", secondary: "#FF6A3D", glow: "rgba(255,59,48,0.45)" },
};

interface BlobConfig {
  size: number;
  initialX: number;
  initialY: number;
  driftRangeX: number;
  driftRangeY: number;
  duration: number;
  delay: number;
  colorKey: "primary" | "secondary";
  alpha: number;
}

const BLOB_CONFIGS: BlobConfig[] = [
  { size: 380, initialX: -100, initialY: -80, driftRangeX: 60, driftRangeY: 40, duration: 10000, delay: 0, colorKey: "primary", alpha: 0.22 },
  { size: 320, initialX: SCREEN_WIDTH - 180, initialY: -60, driftRangeX: 50, driftRangeY: 35, duration: 12000, delay: 500, colorKey: "secondary", alpha: 0.18 },
  { size: 340, initialX: -80, initialY: SCREEN_HEIGHT - 280, driftRangeX: 55, driftRangeY: 45, duration: 11000, delay: 1000, colorKey: "secondary", alpha: 0.20 },
  { size: 400, initialX: SCREEN_WIDTH - 220, initialY: SCREEN_HEIGHT - 320, driftRangeX: 65, driftRangeY: 50, duration: 14000, delay: 300, colorKey: "primary", alpha: 0.24 },
  { size: 260, initialX: SCREEN_WIDTH / 2 - 130, initialY: SCREEN_HEIGHT / 2 - 200, driftRangeX: 80, driftRangeY: 60, duration: 9000, delay: 800, colorKey: "primary", alpha: 0.15 },
];

function AnimatedBlob({ config, riskLevel, fadeValue }: { config: BlobConfig; riskLevel: RiskLevel; fadeValue: SharedValue<number> }) {
  const driftX = useSharedValue(0);
  const driftY = useSharedValue(0);
  const pulse = useSharedValue(0);

  const colors = RISK_COLORS[riskLevel];
  const baseColor = colors[config.colorKey];

  useEffect(() => {
    if (riskLevel !== "none") {
      driftX.value = withDelay(
        config.delay,
        withRepeat(
          withSequence(
            withTiming(1, { duration: config.duration / 2, easing: Easing.inOut(Easing.sin) }),
            withTiming(0, { duration: config.duration / 2, easing: Easing.inOut(Easing.sin) })
          ),
          -1,
          true
        )
      );

      driftY.value = withDelay(
        config.delay + 200,
        withRepeat(
          withSequence(
            withTiming(1, { duration: (config.duration * 0.8) / 2, easing: Easing.inOut(Easing.sin) }),
            withTiming(0, { duration: (config.duration * 0.8) / 2, easing: Easing.inOut(Easing.sin) })
          ),
          -1,
          true
        )
      );

      pulse.value = withDelay(
        config.delay,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.ease) }),
            withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.ease) })
          ),
          -1,
          true
        )
      );
    } else {
      cancelAnimation(driftX);
      cancelAnimation(driftY);
      cancelAnimation(pulse);
    }
  }, [riskLevel, config, driftX, driftY, pulse]);

  const blobStyle = useAnimatedStyle(() => {
    const translateX = interpolate(driftX.value, [0, 1], [-config.driftRangeX / 2, config.driftRangeX / 2]);
    const translateY = interpolate(driftY.value, [0, 1], [-config.driftRangeY / 2, config.driftRangeY / 2]);
    const scale = interpolate(pulse.value, [0, 1], [0.95, 1.05]);
    const opacity = interpolate(pulse.value, [0, 1], [config.alpha * 0.8, config.alpha * 1.2]) * fadeValue.value;

    return {
      opacity,
      transform: [{ translateX }, { translateY }, { scale }],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: config.initialX,
          top: config.initialY,
          width: config.size,
          height: config.size,
          borderRadius: config.size / 2,
          backgroundColor: hexToRgba(baseColor, 0.3),
        },
        blobStyle,
      ]}
    />
  );
}

export function RiskAuraOverlay() {
  const { state } = useSecurityOverlay();
  const { isVisible, riskLevel } = state;

  const fadeValue = useSharedValue(0);

  useEffect(() => {
    if (isVisible && riskLevel !== "none") {
      fadeValue.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.ease) });
    } else {
      fadeValue.value = withTiming(0, { duration: 350, easing: Easing.in(Easing.ease) });
    }
  }, [isVisible, riskLevel, fadeValue]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: fadeValue.value,
    pointerEvents: fadeValue.value > 0.01 ? "none" : "none",
  }));

  const colors = RISK_COLORS[riskLevel];

  if (!isVisible && fadeValue.value === 0) return null;

  const edgeAlpha = riskLevel === "high" ? 0.5 : riskLevel === "medium" ? 0.35 : 0.25;

  return (
    <Animated.View style={[styles.container, containerStyle]} pointerEvents="none">
      <BlurView intensity={8} tint="dark" style={[StyleSheet.absoluteFill, { opacity: 0.4 }]} />

      {BLOB_CONFIGS.map((config, index) => (
        <AnimatedBlob key={index} config={config} riskLevel={riskLevel} fadeValue={fadeValue} />
      ))}

      <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill, { opacity: 0.5 }]} />

      <View style={styles.topEdge}>
        <LinearGradient
          colors={[hexToRgba(colors.primary, edgeAlpha), hexToRgba(colors.secondary, edgeAlpha * 0.5), "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </View>

      <View style={styles.bottomEdge}>
        <LinearGradient
          colors={["transparent", hexToRgba(colors.secondary, edgeAlpha * 0.5), hexToRgba(colors.primary, edgeAlpha)]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </View>

      <View style={styles.leftEdge}>
        <LinearGradient
          colors={[hexToRgba(colors.primary, edgeAlpha * 0.8), hexToRgba(colors.secondary, edgeAlpha * 0.4), "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
        />
      </View>

      <View style={styles.rightEdge}>
        <LinearGradient
          colors={["transparent", hexToRgba(colors.secondary, edgeAlpha * 0.4), hexToRgba(colors.primary, edgeAlpha * 0.8)]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
        />
      </View>

      <View style={styles.cornerTL}>
        <LinearGradient
          colors={[hexToRgba(colors.primary, edgeAlpha * 1.2), "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      </View>
      <View style={styles.cornerTR}>
        <LinearGradient
          colors={[hexToRgba(colors.secondary, edgeAlpha), "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
      </View>
      <View style={styles.cornerBL}>
        <LinearGradient
          colors={[hexToRgba(colors.secondary, edgeAlpha), "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
        />
      </View>
      <View style={styles.cornerBR}>
        <LinearGradient
          colors={[hexToRgba(colors.primary, edgeAlpha * 1.2), "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 1 }}
          end={{ x: 0, y: 0 }}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    overflow: "hidden",
  },
  topEdge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 160,
  },
  bottomEdge: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 160,
  },
  leftEdge: {
    position: "absolute",
    top: 100,
    left: 0,
    bottom: 100,
    width: 90,
  },
  rightEdge: {
    position: "absolute",
    top: 100,
    right: 0,
    bottom: 100,
    width: 90,
  },
  cornerTL: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 140,
    height: 140,
  },
  cornerTR: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 140,
    height: 140,
  },
  cornerBL: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 140,
    height: 140,
  },
  cornerBR: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 140,
    height: 140,
  },
});
