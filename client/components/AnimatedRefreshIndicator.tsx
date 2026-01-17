import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";

interface AnimatedRefreshIndicatorProps {
  isRefreshing: boolean;
  color?: string;
  size?: number;
}

export function AnimatedRefreshIndicator({
  isRefreshing,
  color = "#8B5CF6",
  size = 28,
}: AnimatedRefreshIndicatorProps) {
  const rotation = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);
  const pulseOpacity = useSharedValue(0.3);

  useEffect(() => {
    if (isRefreshing) {
      opacity.value = withTiming(1, { duration: 200 });
      rotation.value = withRepeat(
        withTiming(360, { duration: 1000, easing: Easing.linear }),
        -1,
        false
      );
      scale.value = withRepeat(
        withSequence(
          withTiming(1.1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0.6, { duration: 600, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.2, { duration: 600, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    } else {
      opacity.value = withTiming(0, { duration: 200 });
      rotation.value = 0;
      scale.value = 1;
      pulseOpacity.value = 0.3;
    }
  }, [isRefreshing]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${rotation.value}deg` },
      { scale: scale.value },
    ],
    opacity: opacity.value,
  }));

  const pulseStyle = useAnimatedStyle(() => {
    const pulseScale = interpolate(pulseOpacity.value, [0.2, 0.6], [1, 1.8]);
    return {
      transform: [{ scale: pulseScale }],
      opacity: pulseOpacity.value,
    };
  });

  const glowStyle = useAnimatedStyle(() => {
    const glowScale = interpolate(pulseOpacity.value, [0.2, 0.6], [1.2, 2.2]);
    return {
      transform: [{ scale: glowScale }],
      opacity: interpolate(pulseOpacity.value, [0.2, 0.6], [0.1, 0.3]),
    };
  });

  if (!isRefreshing) return null;

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.glowRing, { borderColor: color }, glowStyle]} />
      <Animated.View style={[styles.pulseRing, { borderColor: color }, pulseStyle]} />
      <Animated.View style={iconStyle}>
        <View style={[styles.iconContainer, { backgroundColor: color + "20" }]}>
          <Feather name="refresh-cw" size={size} color={color} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    height: 60,
    marginBottom: 8,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
  },
  glowRing: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
  },
});
