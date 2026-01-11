import { useState, useEffect, useRef } from "react";
import { View, StyleSheet, Pressable, Animated, Easing, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import { bootstrapApp, BootResult, createBootstrapWithWatchdog } from "@/lib/bootstrap";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

interface SplashScreenProps {
  onBootComplete: (result: BootResult) => void;
}

type BootState = "booting" | "slow" | "timeout" | "error";

function FloatingOrb({ 
  size, 
  color, 
  initialX, 
  initialY, 
  duration 
}: { 
  size: number; 
  color: string; 
  initialX: number; 
  initialY: number; 
  duration: number;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0.15)).current;

  useEffect(() => {
    const floatAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: -20,
          duration: duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.25,
          duration: duration * 0.7,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.1,
          duration: duration * 0.7,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    floatAnimation.start();
    pulseAnimation.start();

    return () => {
      floatAnimation.stop();
      pulseAnimation.stop();
    };
  }, []);

  return (
    <Animated.View
      style={[
        styles.orb,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          left: initialX,
          top: initialY,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    />
  );
}

export default function SplashScreen({ onBootComplete }: SplashScreenProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  
  const [bootState, setBootState] = useState<BootState>("booting");
  const [currentStep, setCurrentStep] = useState("Initializing...");
  const [progress, setProgress] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticInfo, setDiagnosticInfo] = useState<string[]>([]);
  const [retryCount, setRetryCount] = useState(0);

  const logoScale = useRef(new Animated.Value(0.8)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0.3)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(logoScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    const glowPulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glowOpacity, {
          toValue: 0.6,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0.2,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    glowPulse.start();

    return () => {
      glowPulse.stop();
    };
  }, []);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const runBootstrap = async () => {
    setBootState("booting");
    setProgress(0);
    setCurrentStep("Initializing...");
    setDiagnosticInfo([]);

    slowTimerRef.current = setTimeout(() => {
      setBootState("slow");
    }, 2500);

    const stepMap: Record<string, { label: string; pct: number }> = {
      preloadAssets: { label: "Loading assets...", pct: 10 },
      initSettings: { label: "Loading settings...", pct: 25 },
      initChainRegistry: { label: "Preparing chains...", pct: 40 },
      initWalletConnect: { label: "Connecting services...", pct: 60 },
      checkVaultExists: { label: "Checking security...", pct: 80 },
      pingRPC: { label: "Verifying network...", pct: 95 },
    };

    const { run, cancel } = createBootstrapWithWatchdog(
      (step, _pct) => {
        const info = stepMap[step];
        if (info) {
          setCurrentStep(info.label);
          setProgress(info.pct);
          setDiagnosticInfo((prev) => [...prev, `${step}: started`]);
        }
      },
      () => {
        setBootState("timeout");
        setDiagnosticInfo((prev) => [...prev, "Global timeout reached"]);
      }
    );

    try {
      const result = await run();
      
      if (slowTimerRef.current) {
        clearTimeout(slowTimerRef.current);
      }

      setProgress(100);
      setCurrentStep("Ready!");
      setDiagnosticInfo((prev) => [
        ...prev,
        `Boot complete: ${result.initialRoute}`,
        `Sessions restored: ${result.restoredSessionsCount}`,
      ]);

      setTimeout(() => {
        onBootComplete(result);
      }, 400);
    } catch (error: any) {
      if (slowTimerRef.current) {
        clearTimeout(slowTimerRef.current);
      }
      setBootState("error");
      setDiagnosticInfo((prev) => [...prev, `Error: ${error.message}`]);
    }
  };

  useEffect(() => {
    runBootstrap();

    return () => {
      if (slowTimerRef.current) {
        clearTimeout(slowTimerRef.current);
      }
    };
  }, [retryCount]);

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1);
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={[styles.container, { backgroundColor: "#0B0F14" }]}>
      <LinearGradient
        colors={["transparent", "rgba(59, 130, 246, 0.03)", "transparent"]}
        style={styles.gradientOverlay}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      <FloatingOrb size={200} color="#3B82F6" initialX={-60} initialY={SCREEN_HEIGHT * 0.15} duration={4000} />
      <FloatingOrb size={150} color="#60A5FA" initialX={SCREEN_WIDTH - 80} initialY={SCREEN_HEIGHT * 0.6} duration={3500} />
      <FloatingOrb size={100} color="#2563EB" initialX={SCREEN_WIDTH * 0.3} initialY={SCREEN_HEIGHT * 0.75} duration={5000} />
      <FloatingOrb size={80} color="#3B82F6" initialX={SCREEN_WIDTH * 0.7} initialY={SCREEN_HEIGHT * 0.2} duration={4500} />

      <View style={styles.content}>
        <View style={styles.logoWrapper}>
          <Animated.View
            style={[
              styles.glowRing,
              {
                opacity: glowOpacity,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.logoContainer,
              {
                transform: [{ scale: logoScale }],
                opacity: logoOpacity,
              },
            ]}
          >
            <Image
              source={require("../../attached_assets/Untitled_design_1768122796398.png")}
              style={styles.logo}
              contentFit="contain"
            />
          </Animated.View>
        </View>

        <ThemedText type="h1" style={styles.appName}>
          Cordon
        </ThemedText>

        <View style={styles.statusContainer}>
          {bootState === "slow" ? (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Securing your wallet...
            </ThemedText>
          ) : bootState === "timeout" || bootState === "error" ? (
            <ThemedText type="caption" style={{ color: theme.danger }}>
              {bootState === "timeout" ? "Taking longer than expected" : "Something went wrong"}
            </ThemedText>
          ) : (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {currentStep}
            </ThemedText>
          )}
        </View>

        <View style={[styles.progressContainer, { backgroundColor: "rgba(255,255,255,0.08)" }]}>
          <Animated.View
            style={[
              styles.progressBar,
              {
                width: progressWidth,
              },
            ]}
          >
            <LinearGradient
              colors={["#60A5FA", "#3B82F6", "#2563EB"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>

        {(bootState === "timeout" || bootState === "error") ? (
          <View style={styles.actionContainer}>
            <Pressable
              style={[styles.retryButton, { backgroundColor: theme.accent }]}
              onPress={handleRetry}
            >
              <Feather name="refresh-cw" size={18} color="#fff" />
              <ThemedText type="body" style={{ color: "#fff", fontWeight: "600", marginLeft: 8 }}>
                Retry
              </ThemedText>
            </Pressable>

            <Pressable
              style={styles.diagnosticsLink}
              onPress={() => setShowDiagnostics(!showDiagnostics)}
            >
              <ThemedText type="small" style={{ color: theme.textSecondary }}>
                {showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {showDiagnostics ? (
          <View style={[styles.diagnosticsContainer, { backgroundColor: theme.backgroundSecondary }]}>
            {diagnosticInfo.map((info, index) => (
              <ThemedText key={index} type="small" style={{ color: theme.textSecondary, fontFamily: "monospace" }}>
                {info}
              </ThemedText>
            ))}
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <ThemedText type="small" style={{ color: "rgba(255,255,255,0.4)" }}>
          Non-custodial wallet
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  orb: {
    position: "absolute",
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  logoWrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl,
  },
  glowRing: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "#3B82F6",
  },
  logoContainer: {
    width: 140,
    height: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 140,
    height: 140,
  },
  appName: {
    marginBottom: Spacing.sm,
    letterSpacing: 3,
    color: "#fff",
    fontSize: 28,
    fontWeight: "300",
  },
  statusContainer: {
    height: 24,
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  progressContainer: {
    width: 180,
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 2,
    overflow: "hidden",
  },
  actionContainer: {
    marginTop: Spacing.xl,
    alignItems: "center",
    gap: Spacing.md,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  diagnosticsLink: {
    padding: Spacing.sm,
  },
  diagnosticsContainer: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    maxWidth: 300,
    maxHeight: 150,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
  },
});
