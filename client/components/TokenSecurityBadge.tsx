import React from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { RiskLevel, getRiskColor, getRiskIcon } from "@/lib/token-security";

interface TokenSecurityBadgeProps {
  riskLevel: RiskLevel;
  size?: "small" | "medium";
  onPress?: () => void;
}

export function TokenSecurityBadge({ 
  riskLevel, 
  size = "small",
  onPress 
}: TokenSecurityBadgeProps) {
  const color = getRiskColor(riskLevel);
  const iconName = getRiskIcon(riskLevel) as keyof typeof Feather.glyphMap;
  const iconSize = size === "small" ? 12 : 16;
  const containerSize = size === "small" ? 20 : 28;

  const badge = (
    <View 
      style={[
        styles.badge, 
        { 
          backgroundColor: color + "20",
          width: containerSize,
          height: containerSize,
          borderRadius: containerSize / 2,
        }
      ]}
    >
      <Feather name={iconName} size={iconSize} color={color} />
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} hitSlop={8}>
        {badge}
      </Pressable>
    );
  }

  return badge;
}

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    justifyContent: "center",
  },
});
