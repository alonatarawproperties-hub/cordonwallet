import { useEffect } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolate,
} from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";

interface DangerWarningOverlayProps {
  isActive: boolean;
}

const { width, height } = Dimensions.get("window");

export function DangerWarningOverlay({ isActive }: DangerWarningOverlayProps) {
  const { theme } = useTheme();
  const pulseValue = useSharedValue(0);
  const glowValue = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      pulseValue.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 1500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      glowValue.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 2000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    } else {
      pulseValue.value = withTiming(0, { duration: 300 });
      glowValue.value = withTiming(0, { duration: 300 });
    }
  }, [isActive, pulseValue, glowValue]);

  const overlayStyle = useAnimatedStyle(() => {
    const opacity = interpolate(pulseValue.value, [0, 1], [0, 0.15]);
    return {
      opacity,
    };
  });

  const topGlowStyle = useAnimatedStyle(() => {
    const opacity = interpolate(glowValue.value, [0, 1], [0.1, 0.4]);
    return {
      opacity,
    };
  });

  const bottomGlowStyle = useAnimatedStyle(() => {
    const opacity = interpolate(glowValue.value, [0, 1], [0.05, 0.2]);
    return {
      opacity,
    };
  });

  if (!isActive) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={[
          styles.overlay,
          { backgroundColor: theme.danger },
          overlayStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.topGlow,
          { backgroundColor: theme.danger },
          topGlowStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.bottomGlow,
          { backgroundColor: theme.danger },
          bottomGlowStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.leftEdge,
          { backgroundColor: theme.danger },
          topGlowStyle,
        ]}
      />
      <Animated.View
        style={[
          styles.rightEdge,
          { backgroundColor: theme.danger },
          topGlowStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  topGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 150,
  },
  bottomGlow: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
  },
  leftEdge: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: 3,
  },
  rightEdge: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 3,
  },
});
