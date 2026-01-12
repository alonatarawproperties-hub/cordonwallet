import { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

interface DangerWarningOverlayProps {
  isActive: boolean;
}

const EDGE_WIDTH = 12;

export function DangerWarningOverlay({ isActive }: DangerWarningOverlayProps) {
  const pulseValue = useSharedValue(0);
  const glowIntensity = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      pulseValue.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 1200, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );

      glowIntensity.value = withRepeat(
        withSequence(
          withDelay(100, withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) })),
          withTiming(0.4, { duration: 1400, easing: Easing.inOut(Easing.quad) })
        ),
        -1,
        false
      );
    } else {
      pulseValue.value = withTiming(0, { duration: 300 });
      glowIntensity.value = withTiming(0, { duration: 300 });
    }
  }, [isActive, pulseValue, glowIntensity]);

  const edgeStyle = useAnimatedStyle(() => {
    const opacity = interpolate(glowIntensity.value, [0, 1], [0.4, 0.75]);
    return { opacity };
  });

  const cornerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(pulseValue.value, [0, 1], [0.35, 0.8]);
    return { opacity };
  });

  if (!isActive) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      <Animated.View style={[styles.topEdge, edgeStyle]}>
        <LinearGradient
          colors={["rgba(255,50,50,0.9)", "rgba(255,80,0,0.6)", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.bottomEdge, edgeStyle]}>
        <LinearGradient
          colors={["transparent", "rgba(255,80,0,0.6)", "rgba(255,50,50,0.9)"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.leftEdge, edgeStyle]}>
        <LinearGradient
          colors={["rgba(255,50,50,0.9)", "rgba(255,70,0,0.6)", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
        />
      </Animated.View>

      <Animated.View style={[styles.rightEdge, edgeStyle]}>
        <LinearGradient
          colors={["transparent", "rgba(255,70,0,0.6)", "rgba(255,50,50,0.9)"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
        />
      </Animated.View>

      <Animated.View style={[styles.topLeftCorner, cornerStyle]}>
        <LinearGradient
          colors={["rgba(255,60,60,0.85)", "rgba(255,90,0,0.5)", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.topRightCorner, cornerStyle]}>
        <LinearGradient
          colors={["rgba(255,90,0,0.85)", "rgba(255,60,60,0.5)", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.bottomLeftCorner, cornerStyle]}>
        <LinearGradient
          colors={["rgba(255,70,0,0.85)", "rgba(255,50,50,0.5)", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
        />
      </Animated.View>

      <Animated.View style={[styles.bottomRightCorner, cornerStyle]}>
        <LinearGradient
          colors={["rgba(255,60,60,0.85)", "rgba(255,90,0,0.5)", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 1 }}
          end={{ x: 0, y: 0 }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  topEdge: {
    position: "absolute",
    top: 0,
    left: EDGE_WIDTH,
    right: EDGE_WIDTH,
    height: EDGE_WIDTH,
  },
  bottomEdge: {
    position: "absolute",
    bottom: 0,
    left: EDGE_WIDTH,
    right: EDGE_WIDTH,
    height: EDGE_WIDTH,
  },
  leftEdge: {
    position: "absolute",
    top: EDGE_WIDTH,
    left: 0,
    bottom: EDGE_WIDTH,
    width: EDGE_WIDTH,
  },
  rightEdge: {
    position: "absolute",
    top: EDGE_WIDTH,
    right: 0,
    bottom: EDGE_WIDTH,
    width: EDGE_WIDTH,
  },
  topLeftCorner: {
    position: "absolute",
    top: 0,
    left: 0,
    width: EDGE_WIDTH * 1.5,
    height: EDGE_WIDTH * 1.5,
  },
  topRightCorner: {
    position: "absolute",
    top: 0,
    right: 0,
    width: EDGE_WIDTH * 1.5,
    height: EDGE_WIDTH * 1.5,
  },
  bottomLeftCorner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: EDGE_WIDTH * 1.5,
    height: EDGE_WIDTH * 1.5,
  },
  bottomRightCorner: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: EDGE_WIDTH * 1.5,
    height: EDGE_WIDTH * 1.5,
  },
});
