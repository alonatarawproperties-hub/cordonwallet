import { useEffect, useRef } from "react";
import { View, StyleSheet, Dimensions, Platform } from "react-native";
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
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { useSecurityOverlay, RiskLevel } from "@/context/SecurityOverlayContext";

const { width, height } = Dimensions.get("screen");

const RISK_COLORS: Record<RiskLevel, { primary: string; secondary: string; tertiary: string }> = {
  none: { primary: "transparent", secondary: "transparent", tertiary: "transparent" },
  low: { primary: "rgba(59,130,246,0.15)", secondary: "rgba(96,165,250,0.1)", tertiary: "rgba(147,197,253,0.05)" },
  medium: { primary: "rgba(245,158,11,0.4)", secondary: "rgba(251,191,36,0.25)", tertiary: "rgba(252,211,77,0.1)" },
  high: { primary: "rgba(239,68,68,0.65)", secondary: "rgba(249,115,22,0.45)", tertiary: "rgba(234,88,12,0.25)" },
};

const RISK_INTENSITY: Record<RiskLevel, { min: number; max: number }> = {
  none: { min: 0, max: 0 },
  low: { min: 0.15, max: 0.25 },
  medium: { min: 0.35, max: 0.5 },
  high: { min: 0.55, max: 0.75 },
};

export function RiskAuraOverlay() {
  const { state } = useSecurityOverlay();
  const { isVisible, riskLevel } = state;

  const breatheValue = useSharedValue(0);
  const shimmerValue = useSharedValue(0);
  const driftValue = useSharedValue(0);
  const fadeValue = useSharedValue(0);

  useEffect(() => {
    if (isVisible && riskLevel !== "none") {
      fadeValue.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) });

      breatheValue.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 2000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );

      driftValue.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 3000, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 3000, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        false
      );

      shimmerValue.value = withRepeat(
        withDelay(
          2500,
          withSequence(
            withTiming(1, { duration: 800, easing: Easing.out(Easing.ease) }),
            withTiming(0, { duration: 600, easing: Easing.in(Easing.ease) })
          )
        ),
        -1,
        false
      );
    } else {
      fadeValue.value = withTiming(0, { duration: 300 });
      cancelAnimation(breatheValue);
      cancelAnimation(driftValue);
      cancelAnimation(shimmerValue);
    }
  }, [isVisible, riskLevel, breatheValue, driftValue, shimmerValue, fadeValue]);

  const colors = RISK_COLORS[riskLevel];
  const intensity = RISK_INTENSITY[riskLevel];

  const containerStyle = useAnimatedStyle(() => ({
    opacity: fadeValue.value,
  }));

  const topAuraStyle = useAnimatedStyle(() => {
    const opacity = interpolate(breatheValue.value, [0, 1], [intensity.min, intensity.max]);
    const translateY = interpolate(driftValue.value, [0, 1], [-5, 5]);
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  const bottomAuraStyle = useAnimatedStyle(() => {
    const opacity = interpolate(breatheValue.value, [0, 1], [intensity.min * 0.8, intensity.max * 0.8]);
    const translateY = interpolate(driftValue.value, [0, 1], [5, -5]);
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  const leftAuraStyle = useAnimatedStyle(() => {
    const opacity = interpolate(breatheValue.value, [0, 1], [intensity.min * 0.7, intensity.max * 0.7]);
    const translateX = interpolate(driftValue.value, [0, 1], [-3, 3]);
    return {
      opacity,
      transform: [{ translateX }],
    };
  });

  const rightAuraStyle = useAnimatedStyle(() => {
    const opacity = interpolate(breatheValue.value, [0, 1], [intensity.min * 0.7, intensity.max * 0.7]);
    const translateX = interpolate(driftValue.value, [0, 1], [3, -3]);
    return {
      opacity,
      transform: [{ translateX }],
    };
  });

  const shimmerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(shimmerValue.value, [0, 0.5, 1], [0, 0.3, 0]);
    const translateX = interpolate(shimmerValue.value, [0, 1], [-width, width]);
    return {
      opacity,
      transform: [{ translateX }],
    };
  });

  const vignetteStyle = useAnimatedStyle(() => {
    const opacity = interpolate(breatheValue.value, [0, 1], [0.1, 0.2]);
    return { opacity };
  });

  if (!isVisible || riskLevel === "none") return null;

  return (
    <Animated.View style={[styles.container, containerStyle]} pointerEvents="none">
      <Animated.View style={[styles.vignette, vignetteStyle]}>
        <LinearGradient
          colors={["rgba(0,0,0,0.4)", "transparent", "transparent", "rgba(0,0,0,0.4)"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          locations={[0, 0.3, 0.7, 1]}
        />
      </Animated.View>

      <Animated.View style={[styles.topAura, topAuraStyle]}>
        <LinearGradient
          colors={[colors.primary, colors.secondary, colors.tertiary, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          locations={[0, 0.25, 0.5, 1]}
        />
        {Platform.OS === "ios" && (
          <BlurView intensity={15} style={styles.blurOverlay} tint="dark" />
        )}
      </Animated.View>

      <Animated.View style={[styles.bottomAura, bottomAuraStyle]}>
        <LinearGradient
          colors={["transparent", colors.tertiary, colors.secondary, colors.primary]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          locations={[0, 0.5, 0.75, 1]}
        />
        {Platform.OS === "ios" && (
          <BlurView intensity={15} style={styles.blurOverlay} tint="dark" />
        )}
      </Animated.View>

      <Animated.View style={[styles.leftAura, leftAuraStyle]}>
        <LinearGradient
          colors={[colors.primary, colors.secondary, colors.tertiary, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          locations={[0, 0.2, 0.45, 1]}
        />
      </Animated.View>

      <Animated.View style={[styles.rightAura, rightAuraStyle]}>
        <LinearGradient
          colors={["transparent", colors.tertiary, colors.secondary, colors.primary]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          locations={[0, 0.55, 0.8, 1]}
        />
      </Animated.View>

      <Animated.View style={[styles.topLeftBlob, topAuraStyle]}>
        <LinearGradient
          colors={[colors.secondary, colors.tertiary, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.topRightBlob, topAuraStyle]}>
        <LinearGradient
          colors={[colors.primary, colors.tertiary, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.bottomLeftBlob, bottomAuraStyle]}>
        <LinearGradient
          colors={[colors.tertiary, colors.secondary, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
        />
      </Animated.View>

      <Animated.View style={[styles.bottomRightBlob, bottomAuraStyle]}>
        <LinearGradient
          colors={[colors.primary, colors.secondary, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 1 }}
          end={{ x: 0, y: 0 }}
        />
      </Animated.View>

      <Animated.View style={[styles.shimmer, shimmerStyle]}>
        <LinearGradient
          colors={["transparent", "rgba(255,255,255,0.08)", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999999,
    elevation: 999999,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
  },
  topAura: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 180,
    overflow: "hidden",
  },
  bottomAura: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 160,
    overflow: "hidden",
  },
  leftAura: {
    position: "absolute",
    top: 150,
    left: 0,
    bottom: 130,
    width: 60,
  },
  rightAura: {
    position: "absolute",
    top: 150,
    right: 0,
    bottom: 130,
    width: 60,
  },
  topLeftBlob: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 120,
    height: 120,
    borderBottomRightRadius: 120,
  },
  topRightBlob: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 120,
    height: 120,
    borderBottomLeftRadius: 120,
  },
  bottomLeftBlob: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 100,
    height: 100,
    borderTopRightRadius: 100,
  },
  bottomRightBlob: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 100,
    height: 100,
    borderTopLeftRadius: 100,
  },
  shimmer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 100,
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
});
