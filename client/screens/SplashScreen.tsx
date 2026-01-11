import { useState, useEffect, useRef } from "react";
import { View, StyleSheet, Pressable, Animated, Easing, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import { bootstrapApp, BootResult, createBootstrapWithWatchdog } from "@/lib/bootstrap";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface SplashScreenProps {
  onBootComplete: (result: BootResult) => void;
}

type BootState = "booting" | "slow" | "timeout" | "error";

export default function SplashScreen({ onBootComplete }: SplashScreenProps) {
  const insets = useSafeAreaInsets();
  
  const [bootState, setBootState] = useState<BootState>("booting");
  const [currentStep, setCurrentStep] = useState("Initializing...");
  const [progress, setProgress] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticInfo, setDiagnosticInfo] = useState<string[]>([]);
  const [retryCount, setRetryCount] = useState(0);

  const logoScale = useRef(new Animated.Value(0.98)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Animated.timing(logoOpacity, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(logoScale, {
          toValue: 1.02,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 0.98,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    pulseAnimation.start();

    return () => {
      pulseAnimation.stop();
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

    const { run } = createBootstrapWithWatchdog(
      (step) => {
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

  const glowSize = SCREEN_WIDTH * 0.65;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#05070D", "#0A1020", "#070B12"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <View style={styles.content}>
        <View style={styles.logoWrapper}>
          <View
            style={[
              styles.glow,
              {
                width: glowSize,
                height: glowSize,
                borderRadius: glowSize / 2,
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

        <ThemedText type="h2" style={styles.appName}>
          Cordon
        </ThemedText>

        <View style={styles.statusContainer}>
          {bootState === "slow" ? (
            <ThemedText type="caption" style={styles.statusText}>
              Securing your wallet...
            </ThemedText>
          ) : bootState === "timeout" || bootState === "error" ? (
            <ThemedText type="caption" style={styles.errorText}>
              {bootState === "timeout" ? "Taking longer than expected" : "Something went wrong"}
            </ThemedText>
          ) : (
            <ThemedText type="caption" style={styles.statusText}>
              {currentStep}
            </ThemedText>
          )}
        </View>

        <View style={styles.progressContainer}>
          <Animated.View style={[styles.progressBar, { width: progressWidth }]}>
            <LinearGradient
              colors={["#2B7CFF", "#3B82F6"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>

        {(bootState === "timeout" || bootState === "error") ? (
          <View style={styles.actionContainer}>
            <Pressable
              style={styles.retryButton}
              onPress={handleRetry}
            >
              <Feather name="refresh-cw" size={16} color="#fff" />
              <ThemedText type="body" style={styles.retryText}>
                Retry
              </ThemedText>
            </Pressable>

            <Pressable
              style={styles.diagnosticsLink}
              onPress={() => setShowDiagnostics(!showDiagnostics)}
            >
              <ThemedText type="small" style={styles.diagnosticsLinkText}>
                {showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {showDiagnostics ? (
          <View style={styles.diagnosticsContainer}>
            {diagnosticInfo.map((info, index) => (
              <ThemedText key={index} type="small" style={styles.diagnosticText}>
                {info}
              </ThemedText>
            ))}
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <ThemedText type="small" style={styles.footerText}>
          Non-custodial wallet
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#05070D",
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
    marginBottom: Spacing.xl + Spacing.md,
  },
  glow: {
    position: "absolute",
    backgroundColor: "#2B7CFF",
    opacity: 0.15,
  },
  logoContainer: {
    width: 110,
    height: 110,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 110,
    height: 110,
  },
  appName: {
    marginBottom: Spacing.sm,
    letterSpacing: 4,
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "300",
  },
  statusContainer: {
    height: 20,
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  statusText: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 13,
  },
  errorText: {
    color: "#EF4444",
    fontSize: 13,
  },
  progressContainer: {
    width: 140,
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 1,
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
    backgroundColor: "#2B7CFF",
  },
  retryText: {
    color: "#fff",
    fontWeight: "600",
    marginLeft: 8,
  },
  diagnosticsLink: {
    padding: Spacing.sm,
  },
  diagnosticsLinkText: {
    color: "rgba(255, 255, 255, 0.5)",
  },
  diagnosticsContainer: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    maxWidth: 300,
    maxHeight: 150,
  },
  diagnosticText: {
    color: "rgba(255, 255, 255, 0.5)",
    fontFamily: "monospace",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  footerText: {
    color: "rgba(255, 255, 255, 0.25)",
    fontSize: 12,
  },
});
