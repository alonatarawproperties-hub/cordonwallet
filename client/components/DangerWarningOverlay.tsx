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
  interpolateColor,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

interface DangerWarningOverlayProps {
  isActive: boolean;
}

const { width, height } = Dimensions.get("window");

export function DangerWarningOverlay({ isActive }: DangerWarningOverlayProps) {
  const pulseValue = useSharedValue(0);
  const flowValue = useSharedValue(0);
  const glowIntensity = useSharedValue(0);
  const breathValue = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      pulseValue.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );

      flowValue.value = withRepeat(
        withTiming(1, { duration: 3000, easing: Easing.linear }),
        -1,
        false
      );

      glowIntensity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.4, { duration: 1200, easing: Easing.inOut(Easing.quad) })
        ),
        -1,
        false
      );

      breathValue.value = withRepeat(
        withSequence(
          withDelay(200, withTiming(1, { duration: 1000, easing: Easing.out(Easing.ease) })),
          withTiming(0.2, { duration: 1400, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    } else {
      pulseValue.value = withTiming(0, { duration: 300 });
      flowValue.value = withTiming(0, { duration: 300 });
      glowIntensity.value = withTiming(0, { duration: 300 });
      breathValue.value = withTiming(0, { duration: 300 });
    }
  }, [isActive, pulseValue, flowValue, glowIntensity, breathValue]);

  const topEdgeStyle = useAnimatedStyle(() => {
    const opacity = interpolate(glowIntensity.value, [0, 1], [0.5, 1]);
    const scaleY = interpolate(breathValue.value, [0, 1], [0.8, 1.3]);
    return {
      opacity,
      transform: [{ scaleY }],
    };
  });

  const bottomEdgeStyle = useAnimatedStyle(() => {
    const opacity = interpolate(glowIntensity.value, [0, 1], [0.4, 0.9]);
    const scaleY = interpolate(breathValue.value, [0, 1], [0.7, 1.2]);
    return {
      opacity,
      transform: [{ scaleY }],
    };
  });

  const leftEdgeStyle = useAnimatedStyle(() => {
    const opacity = interpolate(pulseValue.value, [0, 1], [0.3, 0.8]);
    const scaleX = interpolate(breathValue.value, [0, 1], [0.6, 1.4]);
    return {
      opacity,
      transform: [{ scaleX }],
    };
  });

  const rightEdgeStyle = useAnimatedStyle(() => {
    const opacity = interpolate(pulseValue.value, [0, 1], [0.3, 0.8]);
    const scaleX = interpolate(breathValue.value, [0, 1], [0.6, 1.4]);
    return {
      opacity,
      transform: [{ scaleX }],
    };
  });

  const cornerGlowStyle = useAnimatedStyle(() => {
    const opacity = interpolate(glowIntensity.value, [0, 1], [0.2, 0.7]);
    const scale = interpolate(breathValue.value, [0, 1], [0.9, 1.2]);
    return {
      opacity,
      transform: [{ scale }],
    };
  });

  const innerPulseStyle = useAnimatedStyle(() => {
    const opacity = interpolate(pulseValue.value, [0, 1], [0, 0.08]);
    return {
      opacity,
    };
  });

  if (!isActive) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[styles.innerPulse, innerPulseStyle]}>
        <LinearGradient
          colors={["#FF0000", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 0.5 }}
        />
      </Animated.View>

      <Animated.View style={[styles.topEdge, topEdgeStyle]}>
        <LinearGradient
          colors={["#FF2020", "#FF4444", "#FF6B00", "#FF2020", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          locations={[0, 0.2, 0.5, 0.7, 1]}
        />
      </Animated.View>

      <Animated.View style={[styles.bottomEdge, bottomEdgeStyle]}>
        <LinearGradient
          colors={["transparent", "#FF2020", "#FF5500", "#FF3030"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          locations={[0, 0.3, 0.6, 1]}
        />
      </Animated.View>

      <Animated.View style={[styles.leftEdge, leftEdgeStyle]}>
        <LinearGradient
          colors={["#FF2020", "#FF4400", "#FF6B00", "#FF2020", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          locations={[0, 0.15, 0.4, 0.6, 1]}
        />
      </Animated.View>

      <Animated.View style={[styles.rightEdge, rightEdgeStyle]}>
        <LinearGradient
          colors={["transparent", "#FF2020", "#FF5500", "#FF4400", "#FF2020"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          locations={[0, 0.4, 0.6, 0.85, 1]}
        />
      </Animated.View>

      <Animated.View style={[styles.topLeftCorner, cornerGlowStyle]}>
        <LinearGradient
          colors={["#FF3030", "#FF5500", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.topRightCorner, cornerGlowStyle]}>
        <LinearGradient
          colors={["#FF5500", "#FF2020", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.bottomLeftCorner, cornerGlowStyle]}>
        <LinearGradient
          colors={["#FF4400", "#FF2020", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
        />
      </Animated.View>

      <Animated.View style={[styles.bottomRightCorner, cornerGlowStyle]}>
        <LinearGradient
          colors={["#FF2020", "#FF6B00", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 1 }}
          end={{ x: 0, y: 0 }}
        />
      </Animated.View>

      <View style={styles.topHighlight}>
        <LinearGradient
          colors={["rgba(255,100,50,0.4)", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  innerPulse: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#FF0000",
  },
  topEdge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  bottomEdge: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
  },
  leftEdge: {
    position: "absolute",
    top: 100,
    left: 0,
    bottom: 80,
    width: 80,
  },
  rightEdge: {
    position: "absolute",
    top: 100,
    right: 0,
    bottom: 80,
    width: 80,
  },
  topLeftCorner: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 150,
    height: 150,
  },
  topRightCorner: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 150,
    height: 150,
  },
  bottomLeftCorner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 120,
    height: 120,
  },
  bottomRightCorner: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 120,
    height: 120,
  },
  topHighlight: {
    position: "absolute",
    top: 0,
    left: "20%",
    right: "20%",
    height: 40,
  },
});
