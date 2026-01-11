import { useState, useEffect, useRef } from "react";
import { View, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import { bootstrapApp, BootResult, createBootstrapWithWatchdog } from "@/lib/bootstrap";

interface SplashScreenProps {
  onBootComplete: (result: BootResult) => void;
}

type BootState = "booting" | "slow" | "timeout" | "error";

export default function SplashScreen({ onBootComplete }: SplashScreenProps) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  
  const [bootState, setBootState] = useState<BootState>("booting");
  const [currentStep, setCurrentStep] = useState("Initializing...");
  const [progress, setProgress] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticInfo, setDiagnosticInfo] = useState<string[]>([]);
  const [retryCount, setRetryCount] = useState(0);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoop.start();
    shimmerLoop.start();

    return () => {
      pulseLoop.stop();
      shimmerLoop.stop();
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
      }, 300);
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

  const shimmerOpacity = shimmerAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 0.6, 0.3],
  });

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View style={styles.content}>
        <Animated.View
          style={[
            styles.logoContainer,
            {
              transform: [{ scale: pulseAnim }],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.shimmerOverlay,
              {
                opacity: shimmerOpacity,
                backgroundColor: theme.accent,
              },
            ]}
          />
          <View style={[styles.logoBackground, { backgroundColor: theme.accent + "15" }]}>
            <Feather name="shield" size={64} color={theme.accent} />
          </View>
        </Animated.View>

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

        <View style={[styles.progressContainer, { backgroundColor: theme.backgroundSecondary }]}>
          <Animated.View
            style={[
              styles.progressBar,
              {
                width: progressWidth,
                backgroundColor: theme.accent,
              },
            ]}
          />
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
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Non-custodial wallet
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  logoContainer: {
    position: "relative",
    marginBottom: Spacing.lg,
  },
  logoBackground: {
    width: 120,
    height: 120,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
  },
  shimmerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 30,
  },
  appName: {
    marginBottom: Spacing.sm,
    letterSpacing: 2,
  },
  statusContainer: {
    height: 24,
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  progressContainer: {
    width: 200,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 2,
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
