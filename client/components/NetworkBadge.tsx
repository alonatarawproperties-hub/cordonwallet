import React from "react";
import { View, StyleSheet, Pressable } from "react-native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

export type NetworkId = "ethereum" | "polygon" | "bsc";

interface NetworkBadgeProps {
  networkId: NetworkId;
  selected?: boolean;
  onPress?: () => void;
}

const NETWORK_CONFIG: Record<NetworkId, { name: string; color: string }> = {
  ethereum: { name: "Ethereum", color: "#627EEA" },
  polygon: { name: "Polygon", color: "#8247E5" },
  bsc: { name: "BSC", color: "#F0B90B" },
};

export function NetworkBadge({ networkId, selected = false, onPress }: NetworkBadgeProps) {
  const { theme } = useTheme();
  const config = NETWORK_CONFIG[networkId];

  const content = (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: selected ? config.color + "30" : theme.backgroundDefault,
          borderColor: selected ? config.color : theme.border,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: config.color }]} />
      <ThemedText
        type="small"
        style={[styles.text, { color: selected ? config.color : theme.text }]}
      >
        {config.name}
      </ThemedText>
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
        {content}
      </Pressable>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    fontWeight: "500",
  },
});
