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
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

interface DangerWarningOverlayProps {
  isActive: boolean;
}

const EDGE_WIDTH = 25;

export function DangerWarningOverlay({ isActive }: DangerWarningOverlayProps) {
  const pulseValue = useSharedValue(0);
  const glowIntensity = useSharedValue(0);
  const breathValue = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      pulseValue.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.4, { duration: 1000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );

      glowIntensity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.5, { duration: 1500, easing: Easing.inOut(Easing.quad) })
        ),
        -1,
        false
      );

      breathValue.value = withRepeat(
        withSequence(
          withDelay(100, withTiming(1, { duration: 1200, easing: Easing.out(Easing.ease) })),
          withTiming(0.3, { duration: 1200, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    } else {
      pulseValue.value = withTiming(0, { duration: 300 });
      glowIntensity.value = withTiming(0, { duration: 300 });
      breathValue.value = withTiming(0, { duration: 300 });
    }
  }, [isActive, pulseValue, glowIntensity, breathValue]);

  const edgeStyle = useAnimatedStyle(() => {
    const opacity = interpolate(glowIntensity.value, [0, 1], [0.6, 1]);
    return { opacity };
  });

  const cornerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(pulseValue.value, [0, 1], [0.5, 0.95]);
    const scale = interpolate(breathValue.value, [0, 1], [0.95, 1.05]);
    return { opacity, transform: [{ scale }] };
  });

  const innerGlowStyle = useAnimatedStyle(() => {
    const opacity = interpolate(pulseValue.value, [0, 1], [0, 0.04]);
    return { opacity };
  });

  if (!isActive) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[styles.innerGlow, innerGlowStyle]}>
        <LinearGradient
          colors={["#FF0000", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 0.4 }}
        />
      </Animated.View>

      <Animated.View style={[styles.topEdge, edgeStyle]}>
        <LinearGradient
          colors={["#FF2020", "#FF5500", "#FF3030", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          locations={[0, 0.3, 0.6, 1]}
        />
      </Animated.View>

      <Animated.View style={[styles.bottomEdge, edgeStyle]}>
        <LinearGradient
          colors={["transparent", "#FF3030", "#FF5500", "#FF2020"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          locations={[0, 0.4, 0.7, 1]}
        />
      </Animated.View>

      <Animated.View style={[styles.leftEdge, edgeStyle]}>
        <LinearGradient
          colors={["#FF2020", "#FF4400", "#FF5500", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          locations={[0, 0.3, 0.6, 1]}
        />
      </Animated.View>

      <Animated.View style={[styles.rightEdge, edgeStyle]}>
        <LinearGradient
          colors={["transparent", "#FF5500", "#FF4400", "#FF2020"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          locations={[0, 0.4, 0.7, 1]}
        />
      </Animated.View>

      <Animated.View style={[styles.topLeftCorner, cornerStyle]}>
        <LinearGradient
          colors={["#FF3030", "#FF5500", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.topRightCorner, cornerStyle]}>
        <LinearGradient
          colors={["#FF5500", "#FF3030", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.bottomLeftCorner, cornerStyle]}>
        <LinearGradient
          colors={["#FF4400", "#FF2020", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
        />
      </Animated.View>

      <Animated.View style={[styles.bottomRightCorner, cornerStyle]}>
        <LinearGradient
          colors={["#FF3030", "#FF5500", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 1 }}
          end={{ x: 0, y: 0 }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  innerGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#FF0000",
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
    width: EDGE_WIDTH * 2,
    height: EDGE_WIDTH * 2,
  },
  topRightCorner: {
    position: "absolute",
    top: 0,
    right: 0,
    width: EDGE_WIDTH * 2,
    height: EDGE_WIDTH * 2,
  },
  bottomLeftCorner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: EDGE_WIDTH * 2,
    height: EDGE_WIDTH * 2,
  },
  bottomRightCorner: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: EDGE_WIDTH * 2,
    height: EDGE_WIDTH * 2,
  },
});
