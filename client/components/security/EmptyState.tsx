import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";

interface EmptyStateProps {
  type: "evm-approvals" | "solana-sessions" | "solana-delegates";
}

const emptyStates = {
  "evm-approvals": {
    icon: "check-circle" as const,
    title: "No EVM approvals found",
    description: "Approvals appear after using dApps like swaps, staking, or NFT mints.",
    color: "#22C55E",
  },
  "solana-sessions": {
    icon: "link-2" as const,
    title: "No connected dApps",
    description: "Connect to dApps using the WalletConnect scanner to see them here.",
    color: "#9945FF",
  },
  "solana-delegates": {
    icon: "check-circle" as const,
    title: "No token delegates found",
    description: "Most Solana apps use per-transaction signing instead of approvals.",
    color: "#22C55E",
  },
};

export function EmptyState({ type }: EmptyStateProps) {
  const { theme } = useTheme();
  const state = emptyStates[type];

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}>
      <View style={[styles.iconContainer, { backgroundColor: `${state.color}20` }]}>
        <Feather name={state.icon} size={32} color={state.color} />
      </View>
      <ThemedText type="body" style={[styles.title, { color: theme.text }]}>
        {state.title}
      </ThemedText>
      <ThemedText type="caption" style={[styles.description, { color: theme.textSecondary }]}>
        {state.description}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: "center",
    marginVertical: Spacing.md,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  title: {
    fontWeight: "600",
    marginBottom: Spacing.xs,
    textAlign: "center",
  },
  description: {
    textAlign: "center",
    maxWidth: 280,
  },
});
