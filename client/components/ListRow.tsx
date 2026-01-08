import React from "react";
import { View, StyleSheet, Pressable, ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

interface ListRowProps {
  title: string;
  subtitle?: string;
  leftIcon?: React.ReactNode;
  rightValue?: string;
  rightElement?: React.ReactNode;
  showChevron?: boolean;
  onPress?: () => void;
  danger?: boolean;
  style?: ViewStyle;
}

export function ListRow({
  title,
  subtitle,
  leftIcon,
  rightValue,
  rightElement,
  showChevron = false,
  onPress,
  danger = false,
  style,
}: ListRowProps) {
  const { theme } = useTheme();

  const content = (
    <View style={[styles.container, { backgroundColor: theme.backgroundDefault }, style]}>
      {leftIcon ? <View style={styles.leftIcon}>{leftIcon}</View> : null}
      <View style={styles.content}>
        <ThemedText 
          type="body" 
          style={[styles.title, danger && { color: theme.danger }]}
        >
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {rightValue ? (
        <ThemedText type="body" style={styles.rightValue}>
          {rightValue}
        </ThemedText>
      ) : null}
      {rightElement}
      {showChevron ? (
        <Feather name="chevron-right" size={20} color={theme.textSecondary} />
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable 
        onPress={onPress}
        style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  leftIcon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
    gap: Spacing.xs,
  },
  title: {
    fontWeight: "500",
  },
  rightValue: {
    fontWeight: "600",
  },
});
