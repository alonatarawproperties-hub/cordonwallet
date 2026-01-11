import { useState } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";

interface DegradedNetworkBannerProps {
  chainName: string;
  reason?: string;
  onDismiss: () => void;
  onChangeRpc?: () => void;
}

export function DegradedNetworkBanner({
  chainName,
  reason,
  onDismiss,
  onChangeRpc,
}: DegradedNetworkBannerProps) {
  const { theme } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.warning + "20", borderColor: theme.warning + "40" }]}>
      <View style={styles.iconContainer}>
        <Feather name="wifi-off" size={18} color={theme.warning} />
      </View>
      <View style={styles.content}>
        <ThemedText type="small" style={{ fontWeight: "600" }}>
          Network degraded for {chainName}
        </ThemedText>
        {reason ? (
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {reason}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.actions}>
        {onChangeRpc ? (
          <Pressable onPress={onChangeRpc} style={styles.actionButton}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              Change RPC
            </ThemedText>
          </Pressable>
        ) : null}
        <Pressable onPress={onDismiss} style={styles.dismissButton}>
          <Feather name="x" size={18} color={theme.textSecondary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  iconContainer: {
    marginRight: Spacing.sm,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  actionButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  dismissButton: {
    padding: Spacing.xs,
  },
});
