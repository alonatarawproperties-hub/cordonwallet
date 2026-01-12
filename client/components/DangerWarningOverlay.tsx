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
import { LinearGradient } from "expo-linear-gradient";

interface DangerWarningOverlayProps {
  isActive: boolean;
}

const { width, height } = Dimensions.get("screen");
const EDGE_THICKNESS = 10;
const FADE_LENGTH = 40;

export function DangerWarningOverlay({ isActive }: DangerWarningOverlayProps) {
  const pulseValue = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      pulseValue.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 1300, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    } else {
      pulseValue.value = withTiming(0, { duration: 300 });
    }
  }, [isActive, pulseValue]);

  const animatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(pulseValue.value, [0, 1], [0.5, 0.9]);
    return { opacity };
  });

  if (!isActive) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      <Animated.View style={[styles.topEdge, animatedStyle]}>
        <LinearGradient
          colors={["rgba(255,40,40,0.85)", "rgba(255,80,0,0.5)", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.bottomEdge, animatedStyle]}>
        <LinearGradient
          colors={["transparent", "rgba(255,80,0,0.5)", "rgba(255,40,40,0.85)"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </Animated.View>

      <Animated.View style={[styles.leftEdge, animatedStyle]}>
        <LinearGradient
          colors={["rgba(255,40,40,0.85)", "rgba(255,80,0,0.5)", "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
        />
      </Animated.View>

      <Animated.View style={[styles.rightEdge, animatedStyle]}>
        <LinearGradient
          colors={["transparent", "rgba(255,80,0,0.5)", "rgba(255,40,40,0.85)"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99999,
    elevation: 99999,
  },
  topEdge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: FADE_LENGTH,
  },
  bottomEdge: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: FADE_LENGTH,
  },
  leftEdge: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: FADE_LENGTH,
  },
  rightEdge: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: FADE_LENGTH,
  },
});
