import { View, Pressable, StyleSheet, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import { getChainLogoUrl } from "@/lib/token-logos";

export type ChainType = "evm" | "solana";

interface ChainOption {
  id: ChainType;
  name: string;
  description: string;
}

const CHAIN_OPTIONS: ChainOption[] = [
  { id: "evm", name: "EVM", description: "ETH, Polygon, BSC" },
  { id: "solana", name: "Solana", description: "SOL, SPL tokens" },
];

interface ChainSelectorProps {
  selected: ChainType;
  onSelect: (chain: ChainType) => void;
  compact?: boolean;
}

export function ChainSelector({ selected, onSelect, compact = false }: ChainSelectorProps) {
  const { theme } = useTheme();

  if (compact) {
    return (
      <View style={styles.compactContainer}>
        {CHAIN_OPTIONS.map((option) => {
          const isSelected = selected === option.id;
          const logoUrl = option.id === "solana" 
            ? getChainLogoUrl("solana") 
            : getChainLogoUrl(1);
          
          return (
            <Pressable
              key={option.id}
              style={[
                styles.compactButton,
                {
                  backgroundColor: isSelected ? theme.accent + "20" : theme.backgroundSecondary,
                  borderColor: isSelected ? theme.accent : "transparent",
                },
              ]}
              onPress={() => onSelect(option.id)}
            >
              {logoUrl ? (
                <Image source={{ uri: logoUrl }} style={styles.compactLogo} />
              ) : (
                <Feather name="globe" size={14} color={isSelected ? theme.accent : theme.textSecondary} />
              )}
              <ThemedText
                type="small"
                style={{ color: isSelected ? theme.accent : theme.textSecondary, fontWeight: isSelected ? "600" : "400" }}
              >
                {option.name}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {CHAIN_OPTIONS.map((option) => {
        const isSelected = selected === option.id;
        const logoUrl = option.id === "solana" 
          ? getChainLogoUrl("solana") 
          : getChainLogoUrl(1);

        return (
          <Pressable
            key={option.id}
            style={[
              styles.optionButton,
              {
                backgroundColor: isSelected ? theme.accent + "15" : theme.backgroundSecondary,
                borderColor: isSelected ? theme.accent : theme.border,
              },
            ]}
            onPress={() => onSelect(option.id)}
          >
            <View style={styles.optionContent}>
              {logoUrl ? (
                <Image source={{ uri: logoUrl }} style={styles.logo} />
              ) : (
                <View style={[styles.logoFallback, { backgroundColor: theme.accent + "20" }]}>
                  <Feather name="globe" size={18} color={theme.accent} />
                </View>
              )}
              <View style={styles.optionText}>
                <ThemedText type="body" style={{ fontWeight: "600" }}>
                  {option.name}
                </ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  {option.description}
                </ThemedText>
              </View>
            </View>
            {isSelected ? (
              <View style={[styles.checkIcon, { backgroundColor: theme.accent }]}>
                <Feather name="check" size={12} color="#fff" />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.sm,
  },
  optionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  optionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  logoFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: {
    gap: 2,
  },
  checkIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  compactContainer: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  compactButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  compactLogo: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
});
