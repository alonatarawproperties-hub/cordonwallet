import { useEffect } from "react";
import { View, StyleSheet, Modal, Dimensions, Platform } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

type RiskLevel = "low" | "medium" | "high";

const RISK_COLORS: Record<RiskLevel, { primary: string; secondary: string }> = {
  low: { primary: "#3B82F6", secondary: "#60A5FA" },
  medium: { primary: "#F59E0B", secondary: "#FBBF24" },
  high: { primary: "#EF4444", secondary: "#F87171" },
};

const BORDER_WIDTH = 4;
const GLOW_SPREAD = 60;
const CORNER_RADIUS = Platform.OS === "ios" ? 47 : 24;

interface RiskBorderProps {
  level: RiskLevel;
  visible: boolean;
}

export function RiskBorder({ level, visible }: RiskBorderProps) {
  const pulseValue = useSharedValue(0);
  const { width, height } = Dimensions.get("window");

  useEffect(() => {
    if (visible) {
      pulseValue.value = withRepeat(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      pulseValue.value = 0;
    }
  }, [visible, pulseValue]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulseValue.value, [0, 0.5, 1], [0.6, 1, 0.6]),
  }));

  if (!visible) {
    return null;
  }

  const colors = RISK_COLORS[level];

  return (
    <Modal
      visible={true}
      transparent={true}
      animationType="fade"
      statusBarTranslucent={true}
      hardwareAccelerated={true}
    >
      <View style={styles.modalContainer} pointerEvents="none">
        <Animated.View style={[styles.overlayFrame, pulseStyle]}>
          <View
            style={[
              styles.borderFrame,
              {
                borderRadius: CORNER_RADIUS,
                borderColor: colors.primary,
                shadowColor: colors.primary,
              },
            ]}
          />

          <View
            style={[
              styles.glowFrame,
              {
                borderRadius: CORNER_RADIUS + GLOW_SPREAD / 2,
              },
            ]}
          >
            <LinearGradient
              colors={[`${colors.primary}00`, `${colors.primary}60`, colors.primary]}
              style={[styles.glowGradient, { borderRadius: CORNER_RADIUS + GLOW_SPREAD / 2 }]}
              start={{ x: 0.5, y: 0.5 }}
              end={{ x: 0.5, y: 0 }}
            />
          </View>

          <View style={[styles.cornerGlow, styles.topLeftCorner]}>
            <LinearGradient
              colors={[colors.primary, `${colors.primary}40`, "transparent"]}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
          </View>
          <View style={[styles.cornerGlow, styles.topRightCorner]}>
            <LinearGradient
              colors={[colors.primary, `${colors.primary}40`, "transparent"]}
              style={StyleSheet.absoluteFill}
              start={{ x: 1, y: 0 }}
              end={{ x: 0, y: 1 }}
            />
          </View>
          <View style={[styles.cornerGlow, styles.bottomLeftCorner]}>
            <LinearGradient
              colors={[colors.primary, `${colors.primary}40`, "transparent"]}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 1 }}
              end={{ x: 1, y: 0 }}
            />
          </View>
          <View style={[styles.cornerGlow, styles.bottomRightCorner]}>
            <LinearGradient
              colors={[colors.primary, `${colors.primary}40`, "transparent"]}
              style={StyleSheet.absoluteFill}
              start={{ x: 1, y: 1 }}
              end={{ x: 0, y: 0 }}
            />
          </View>

          <View style={styles.topGlow}>
            <LinearGradient
              colors={[`${colors.primary}90`, `${colors.primary}50`, "transparent"]}
              style={StyleSheet.absoluteFill}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
            />
          </View>
          <View style={styles.bottomGlow}>
            <LinearGradient
              colors={["transparent", `${colors.primary}50`, `${colors.primary}90`]}
              style={StyleSheet.absoluteFill}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
            />
          </View>
          <View style={styles.leftGlow}>
            <LinearGradient
              colors={[`${colors.primary}90`, `${colors.primary}50`, "transparent"]}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
            />
          </View>
          <View style={styles.rightGlow}>
            <LinearGradient
              colors={["transparent", `${colors.primary}50`, `${colors.primary}90`]}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const CORNER_SIZE = CORNER_RADIUS + GLOW_SPREAD;

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: "transparent",
  },
  overlayFrame: {
    ...StyleSheet.absoluteFillObject,
  },
  borderFrame: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: BORDER_WIDTH,
    backgroundColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 10,
  },
  glowFrame: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  glowGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  cornerGlow: {
    position: "absolute",
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderRadius: CORNER_RADIUS,
    overflow: "hidden",
  },
  topLeftCorner: {
    top: 0,
    left: 0,
  },
  topRightCorner: {
    top: 0,
    right: 0,
  },
  bottomLeftCorner: {
    bottom: 0,
    left: 0,
  },
  bottomRightCorner: {
    bottom: 0,
    right: 0,
  },
  topGlow: {
    position: "absolute",
    top: CORNER_RADIUS,
    left: CORNER_SIZE,
    right: CORNER_SIZE,
    height: GLOW_SPREAD,
  },
  bottomGlow: {
    position: "absolute",
    bottom: CORNER_RADIUS,
    left: CORNER_SIZE,
    right: CORNER_SIZE,
    height: GLOW_SPREAD,
  },
  leftGlow: {
    position: "absolute",
    top: CORNER_SIZE,
    left: 0,
    bottom: CORNER_SIZE,
    width: GLOW_SPREAD,
  },
  rightGlow: {
    position: "absolute",
    top: CORNER_SIZE,
    right: 0,
    bottom: CORNER_SIZE,
    width: GLOW_SPREAD,
  },
});
