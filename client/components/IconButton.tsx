import React from "react";
import { Pressable, StyleSheet, ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

interface IconButtonProps {
  icon: keyof typeof Feather.glyphMap;
  onPress?: () => void;
  size?: number;
  variant?: "default" | "accent" | "danger";
  style?: ViewStyle;
  disabled?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function IconButton({
  icon,
  onPress,
  size = 24,
  variant = "default",
  style,
  disabled = false,
}: IconButtonProps) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.9);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1);
  };

  const getColors = () => {
    switch (variant) {
      case "accent":
        return { bg: theme.accent + "20", icon: theme.accent };
      case "danger":
        return { bg: theme.danger + "20", icon: theme.danger };
      default:
        return { bg: theme.backgroundDefault, icon: theme.text };
    }
  };

  const colors = getColors();

  return (
    <AnimatedPressable
      onPress={disabled ? undefined : onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={[
        styles.button,
        { backgroundColor: colors.bg, opacity: disabled ? 0.5 : 1 },
        style,
        animatedStyle,
      ]}
    >
      <Feather name={icon} size={size} color={colors.icon} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
