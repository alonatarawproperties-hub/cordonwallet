import { useEffect, useState } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  runOnJS,
  SharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

import { useSecurityOverlay, RiskLevel } from "@/context/SecurityOverlayContext";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("screen");

const RISK_COLORS: Record<RiskLevel, { colors: string[]; glowColor: string }> = {
  none: { colors: ["transparent", "transparent"], glowColor: "transparent" },
  low: { 
    colors: ["#2E90FF", "#60A5FA", "#3B82F6", "#1D4ED8", "#2E90FF"],
    glowColor: "rgba(46,144,255,0.6)" 
  },
  medium: { 
    colors: ["#FFB020", "#FBBF24", "#F59E0B", "#D97706", "#FFB020"],
    glowColor: "rgba(255,176,32,0.6)" 
  },
  high: { 
    colors: ["#FF3B30", "#FF6B6B", "#FF4757", "#E74C3C", "#FF3B30", "#FF6B6B", "#C0392B", "#FF3B30"],
    glowColor: "rgba(255,59,48,0.7)" 
  },
};

const BORDER_WIDTH = 4;
const GLOW_SIZE = 80;

function AnimatedBorderSegment({ 
  position, 
  riskLevel, 
  animationProgress, 
  fadeValue 
}: { 
  position: "top" | "bottom" | "left" | "right";
  riskLevel: RiskLevel;
  animationProgress: SharedValue<number>;
  fadeValue: SharedValue<number>;
}) {
  const colors = RISK_COLORS[riskLevel];
  
  const gradientStyle = useAnimatedStyle(() => {
    const offset = position === "top" ? 0 : 
                   position === "right" ? 0.25 : 
                   position === "bottom" ? 0.5 : 0.75;
    const adjustedProgress = (animationProgress.value + offset) % 1;
    
    return {
      opacity: fadeValue.value,
      transform: position === "top" || position === "bottom" 
        ? [{ translateX: interpolate(adjustedProgress, [0, 1], [-SCREEN_WIDTH, SCREEN_WIDTH]) }]
        : [{ translateY: interpolate(adjustedProgress, [0, 1], [-SCREEN_HEIGHT, SCREEN_HEIGHT]) }],
    };
  });

  const isHorizontal = position === "top" || position === "bottom";
  const gradientStart = isHorizontal ? { x: 0, y: 0.5 } : { x: 0.5, y: 0 };
  const gradientEnd = isHorizontal ? { x: 1, y: 0.5 } : { x: 0.5, y: 1 };

  return (
    <View style={[styles.borderSegment, styles[`${position}Border`]]}>
      <Animated.View style={[StyleSheet.absoluteFill, gradientStyle]}>
        <LinearGradient
          colors={[...colors.colors, ...colors.colors] as [string, string, ...string[]]}
          style={[StyleSheet.absoluteFill, isHorizontal ? { width: SCREEN_WIDTH * 3 } : { height: SCREEN_HEIGHT * 3 }]}
          start={gradientStart}
          end={gradientEnd}
        />
      </Animated.View>
    </View>
  );
}

function AnimatedGlowOrb({ 
  index, 
  riskLevel, 
  animationProgress, 
  fadeValue 
}: { 
  index: number;
  riskLevel: RiskLevel;
  animationProgress: SharedValue<number>;
  fadeValue: SharedValue<number>;
}) {
  const colors = RISK_COLORS[riskLevel];
  const orbOffset = index / 6;
  
  const orbStyle = useAnimatedStyle(() => {
    const progress = (animationProgress.value + orbOffset) % 1;
    const perimeter = (SCREEN_WIDTH + SCREEN_HEIGHT) * 2;
    const distance = progress * perimeter;
    
    let x = 0, y = 0;
    
    if (distance < SCREEN_WIDTH) {
      x = distance;
      y = 0;
    } else if (distance < SCREEN_WIDTH + SCREEN_HEIGHT) {
      x = SCREEN_WIDTH;
      y = distance - SCREEN_WIDTH;
    } else if (distance < SCREEN_WIDTH * 2 + SCREEN_HEIGHT) {
      x = SCREEN_WIDTH - (distance - SCREEN_WIDTH - SCREEN_HEIGHT);
      y = SCREEN_HEIGHT;
    } else {
      x = 0;
      y = SCREEN_HEIGHT - (distance - SCREEN_WIDTH * 2 - SCREEN_HEIGHT);
    }
    
    const pulse = Math.sin(animationProgress.value * Math.PI * 4 + index) * 0.3 + 1;
    
    return {
      opacity: fadeValue.value * 0.8,
      transform: [
        { translateX: x - GLOW_SIZE / 2 },
        { translateY: y - GLOW_SIZE / 2 },
        { scale: pulse },
      ],
    };
  });

  return (
    <Animated.View style={[styles.glowOrb, orbStyle]}>
      <LinearGradient
        colors={["transparent", colors.glowColor, colors.glowColor, "transparent"]}
        style={styles.glowGradient}
        start={{ x: 0.5, y: 0.5 }}
        end={{ x: 1, y: 1 }}
      />
    </Animated.View>
  );
}

export function RiskAuraOverlay() {
  const { state } = useSecurityOverlay();
  const { isVisible, riskLevel } = state;

  const fadeValue = useSharedValue(0);
  const animationProgress = useSharedValue(0);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (isVisible && riskLevel !== "none") {
      setShouldRender(true);
      fadeValue.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) });
      animationProgress.value = withRepeat(
        withTiming(1, { duration: 4000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      fadeValue.value = withTiming(0, { duration: 300, easing: Easing.in(Easing.ease) }, (finished) => {
        "worklet";
        if (finished) {
          runOnJS(setShouldRender)(false);
        }
      });
    }
  }, [isVisible, riskLevel, fadeValue, animationProgress]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: fadeValue.value,
  }));

  if (!shouldRender) return null;

  const colors = RISK_COLORS[riskLevel];

  return (
    <Animated.View style={[styles.container, containerStyle]} pointerEvents="none">
      {/* Subtle blur background */}
      <BlurView intensity={15} tint="dark" style={[StyleSheet.absoluteFill, { opacity: 0.2 }]} />
      
      {/* Animated glow orbs traveling around the perimeter */}
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <AnimatedGlowOrb
          key={index}
          index={index}
          riskLevel={riskLevel}
          animationProgress={animationProgress}
          fadeValue={fadeValue}
        />
      ))}
      
      {/* Static edge glows for consistent presence */}
      <View style={styles.topGlow}>
        <LinearGradient
          colors={[colors.glowColor, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </View>
      
      <View style={styles.bottomGlow}>
        <LinearGradient
          colors={["transparent", colors.glowColor]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />
      </View>
      
      <View style={styles.leftGlow}>
        <LinearGradient
          colors={[colors.glowColor, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
        />
      </View>
      
      <View style={styles.rightGlow}>
        <LinearGradient
          colors={["transparent", colors.glowColor]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
        />
      </View>

      {/* Animated color borders */}
      <AnimatedBorderSegment position="top" riskLevel={riskLevel} animationProgress={animationProgress} fadeValue={fadeValue} />
      <AnimatedBorderSegment position="bottom" riskLevel={riskLevel} animationProgress={animationProgress} fadeValue={fadeValue} />
      <AnimatedBorderSegment position="left" riskLevel={riskLevel} animationProgress={animationProgress} fadeValue={fadeValue} />
      <AnimatedBorderSegment position="right" riskLevel={riskLevel} animationProgress={animationProgress} fadeValue={fadeValue} />

      {/* Corner accent glows */}
      <View style={styles.cornerTL}>
        <LinearGradient
          colors={[colors.glowColor, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
      </View>
      <View style={styles.cornerTR}>
        <LinearGradient
          colors={[colors.glowColor, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
      </View>
      <View style={styles.cornerBL}>
        <LinearGradient
          colors={[colors.glowColor, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 1 }}
          end={{ x: 1, y: 0 }}
        />
      </View>
      <View style={styles.cornerBR}>
        <LinearGradient
          colors={[colors.glowColor, "transparent"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 1, y: 1 }}
          end={{ x: 0, y: 0 }}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    overflow: "hidden",
  },
  borderSegment: {
    position: "absolute",
    overflow: "hidden",
  },
  topBorder: {
    top: 0,
    left: 0,
    right: 0,
    height: BORDER_WIDTH,
  },
  bottomBorder: {
    bottom: 0,
    left: 0,
    right: 0,
    height: BORDER_WIDTH,
  },
  leftBorder: {
    top: 0,
    left: 0,
    bottom: 0,
    width: BORDER_WIDTH,
  },
  rightBorder: {
    top: 0,
    right: 0,
    bottom: 0,
    width: BORDER_WIDTH,
  },
  glowOrb: {
    position: "absolute",
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
  },
  glowGradient: {
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
  },
  topGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 100,
  },
  bottomGlow: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
  },
  leftGlow: {
    position: "absolute",
    top: 100,
    left: 0,
    bottom: 100,
    width: 60,
  },
  rightGlow: {
    position: "absolute",
    top: 100,
    right: 0,
    bottom: 100,
    width: 60,
  },
  cornerTL: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 150,
    height: 150,
  },
  cornerTR: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 150,
    height: 150,
  },
  cornerBL: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 150,
    height: 150,
  },
  cornerBR: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 150,
    height: 150,
  },
});
