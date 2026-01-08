import React from "react";
import { View, StyleSheet } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Typography } from "@/constants/theme";

type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "accent";

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

export function Badge({ label, variant = "neutral" }: BadgeProps) {
  const { theme } = useTheme();

  const getColors = () => {
    switch (variant) {
      case "success":
        return { bg: theme.success + "20", text: theme.success };
      case "warning":
        return { bg: theme.warning + "20", text: theme.warning };
      case "danger":
        return { bg: theme.danger + "20", text: theme.danger };
      case "accent":
        return { bg: theme.accent + "20", text: theme.accent };
      default:
        return { bg: theme.backgroundSecondary, text: theme.textSecondary };
    }
  };

  const colors = getColors();

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <ThemedText style={[styles.text, { color: colors.text }]}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: Typography.caption.fontSize,
    fontWeight: "600",
  },
});
