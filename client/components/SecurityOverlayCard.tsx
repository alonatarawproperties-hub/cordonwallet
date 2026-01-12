import { useEffect } from "react";
import { View, StyleSheet, Pressable, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";

import { useSecurityOverlay, RiskLevel } from "@/context/SecurityOverlayContext";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const CARD_HEIGHT = 280;

const RISK_CONFIG: Record<RiskLevel, { color: string; icon: keyof typeof Feather.glyphMap; label: string }> = {
  none: { color: "#6B7280", icon: "shield", label: "None" },
  low: { color: "#3B82F6", icon: "info", label: "Low Risk" },
  medium: { color: "#F59E0B", icon: "alert-triangle", label: "Medium Risk" },
  high: { color: "#EF4444", icon: "alert-octagon", label: "High Risk" },
};

interface Props {
  onContinue?: () => void;
  onCancel?: () => void;
}

export function SecurityOverlayCard({ onContinue, onCancel }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, hideRiskAura, acknowledgeRisk } = useSecurityOverlay();
  const { isVisible, riskLevel, reason } = state;

  const translateY = useSharedValue(CARD_HEIGHT + 100);
  const opacity = useSharedValue(0);
  const backdropOpacity = useSharedValue(0);

  const isHighRisk = riskLevel === "high";
  const config = RISK_CONFIG[riskLevel];

  useEffect(() => {
    if (isVisible && riskLevel !== "none") {
      opacity.value = withTiming(1, { duration: 200 });
      translateY.value = withSpring(0, {
        damping: 20,
        stiffness: 300,
        mass: 0.8,
      });
      backdropOpacity.value = withTiming(isHighRisk ? 0.5 : 0, { duration: 300 });
    } else {
      opacity.value = withTiming(0, { duration: 150 });
      translateY.value = withSpring(CARD_HEIGHT + 100, {
        damping: 25,
        stiffness: 400,
      });
      backdropOpacity.value = withTiming(0, { duration: 150 });
    }
  }, [isVisible, riskLevel, isHighRisk, translateY, opacity, backdropOpacity]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const handleContinue = () => {
    if (isHighRisk) {
      acknowledgeRisk();
    } else {
      hideRiskAura();
    }
    onContinue?.();
  };

  const handleCancel = () => {
    hideRiskAura();
    onCancel?.();
  };

  if (!isVisible || riskLevel === "none") return null;

  return (
    <View 
      style={styles.container} 
      pointerEvents={isHighRisk ? "auto" : "box-none"}
    >
      {isHighRisk && (
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={handleCancel} />
        </Animated.View>
      )}

      <Animated.View 
        style={[
          styles.card, 
          cardStyle, 
          { 
            backgroundColor: theme.backgroundSecondary,
            paddingBottom: insets.bottom + Spacing.lg,
          }
        ]}
      >
        <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
        
        <View style={styles.handle} />

        <View style={styles.header}>
          <View style={[styles.iconContainer, { backgroundColor: config.color + "20" }]}>
            <Feather name={config.icon} size={24} color={config.color} />
          </View>
          <View style={styles.headerText}>
            <ThemedText type="h3" style={{ fontWeight: "700" }}>
              Security Warning
            </ThemedText>
            <View style={[styles.badge, { backgroundColor: config.color + "20" }]}>
              <ThemedText type="caption" style={{ color: config.color, fontWeight: "600" }}>
                {config.label}
              </ThemedText>
            </View>
          </View>
        </View>

        <View style={[styles.reasonContainer, { backgroundColor: theme.backgroundTertiary }]}>
          <ThemedText type="body" style={{ color: theme.textSecondary, lineHeight: 22 }}>
            {reason || "A potential security concern was detected with this transaction."}
          </ThemedText>
        </View>

        <View style={styles.buttons}>
          {isHighRisk ? (
            <>
              <Pressable 
                onPress={handleCancel}
                style={[styles.button, styles.buttonSecondary, { borderColor: theme.success, borderWidth: 1 }]}
              >
                <ThemedText style={{ color: theme.success, fontWeight: "600" }}>
                  Cancel (Recommended)
                </ThemedText>
              </Pressable>
              <Pressable 
                onPress={handleContinue}
                style={[styles.button, { backgroundColor: theme.danger }]}
              >
                <ThemedText style={{ color: "#FFFFFF", fontWeight: "600" }}>
                  I Understand, Continue
                </ThemedText>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable 
                onPress={handleCancel}
                style={[styles.button, styles.buttonSecondary]}
              >
                <ThemedText style={{ fontWeight: "600" }}>Cancel</ThemedText>
              </Pressable>
              <Pressable 
                onPress={handleContinue}
                style={[styles.button, { backgroundColor: theme.accent }]}
              >
                <ThemedText style={{ color: "#FFFFFF", fontWeight: "600" }}>
                  Continue
                </ThemedText>
              </Pressable>
            </>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999998,
    elevation: 999998,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  card: {
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    overflow: "hidden",
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: Spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
    gap: Spacing.xs,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  reasonContainer: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.lg,
  },
  buttons: {
    gap: Spacing.sm,
  },
  button: {
    width: "100%",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonSecondary: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
});
