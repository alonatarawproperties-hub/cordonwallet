import { useState, useEffect, useRef } from "react";
import { View, StyleSheet, Pressable, Animated, Easing } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import { BootResult, createBootstrapWithWatchdog } from "@/lib/bootstrap";

interface SplashScreenProps {
  onBootComplete: (result: BootResult) => void;
}

type BootState = "booting" | "slow" | "timeout" | "error";

function Sparkle({ delay, angle, distance }: { delay: number; angle: number; distance: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: 600,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.5,
            duration: 600,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(800),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  const radians = (angle * Math.PI) / 180;
  const x = Math.cos(radians) * distance;
  const y = Math.sin(radians) * distance;

  return (
    <Animated.View
      style={[
        styles.sparkle,
        {
          opacity,
          transform: [
            { translateX: x },
            { translateY: y },
            { scale },
          ],
        },
      ]}
    />
  );
}

export default function SplashScreen({ onBootComplete }: SplashScreenProps) {
  const insets = useSafeAreaInsets();
  
  const [bootState, setBootState] = useState<BootState>("booting");
  const [currentStep, setCurrentStep] = useState("Initializing...");
  const [progress, setProgress] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticInfo, setDiagnosticInfo] = useState<string[]>([]);
  const [retryCount, setRetryCount] = useState(0);

  const logoOpacity = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sparkles = [
    { angle: 0, distance: 70, delay: 0 },
    { angle: 45, distance: 75, delay: 200 },
    { angle: 90, distance: 70, delay: 400 },
    { angle: 135, distance: 75, delay: 600 },
    { angle: 180, distance: 70, delay: 800 },
    { angle: 225, distance: 75, delay: 1000 },
    { angle: 270, distance: 70, delay: 1200 },
    { angle: 315, distance: 75, delay: 1400 },
  ];

  useEffect(() => {
    Animated.timing(logoOpacity, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
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

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#0B0F14", "#0D1117", "#0B0F14"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <View style={styles.content}>
        <View style={styles.logoWrapper}>
          {sparkles.map((sparkle, index) => (
            <Sparkle
              key={index}
              angle={sparkle.angle}
              distance={sparkle.distance}
              delay={sparkle.delay}
            />
          ))}
          <Animated.View
            style={[
              styles.logoContainer,
              { opacity: logoOpacity },
            ]}
          >
            <Image
              source={require("../../assets/images/splash-icon.png")}
              style={styles.logo}
              contentFit="contain"
              priority="high"
            />
          </Animated.View>
        </View>

        <ThemedText style={styles.appName}>
          Cordon
        </ThemedText>

        <View style={styles.statusContainer}>
          {bootState === "slow" ? (
            <ThemedText style={styles.statusText}>
              Securing your wallet...
            </ThemedText>
          ) : bootState === "timeout" || bootState === "error" ? (
            <ThemedText style={styles.errorText}>
              {bootState === "timeout" ? "Taking longer than expected" : "Something went wrong"}
            </ThemedText>
          ) : (
            <ThemedText style={styles.statusText}>
              {currentStep}
            </ThemedText>
          )}
        </View>

        <View style={styles.progressContainer}>
          <Animated.View style={[styles.progressBar, { width: progressWidth }]}>
            <LinearGradient
              colors={["#3B82F6", "#60A5FA"]}
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
              <ThemedText style={styles.retryText}>
                Retry
              </ThemedText>
            </Pressable>

            <Pressable
              style={styles.diagnosticsLink}
              onPress={() => setShowDiagnostics(!showDiagnostics)}
            >
              <ThemedText style={styles.diagnosticsLinkText}>
                {showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {showDiagnostics ? (
          <View style={styles.diagnosticsContainer}>
            {diagnosticInfo.map((info, index) => (
              <ThemedText key={index} style={styles.diagnosticText}>
                {info}
              </ThemedText>
            ))}
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <ThemedText style={styles.footerText}>
          Non-custodial wallet
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F14",
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
    width: 160,
    height: 160,
    marginBottom: Spacing.md,
  },
  sparkle: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#60A5FA",
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  logoContainer: {
    width: 100,
    height: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 100,
    height: 100,
  },
  appName: {
    marginBottom: Spacing.xs,
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "600",
    letterSpacing: 1,
  },
  statusContainer: {
    height: 24,
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  statusText: {
    color: "rgba(255, 255, 255, 0.5)",
    fontSize: 14,
  },
  errorText: {
    color: "#EF4444",
    fontSize: 14,
  },
  progressContainer: {
    width: 120,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 1.5,
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
    backgroundColor: "#3B82F6",
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
    color: "rgba(255, 255, 255, 0.4)",
    fontSize: 12,
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
    color: "rgba(255, 255, 255, 0.4)",
    fontFamily: "monospace",
    fontSize: 11,
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
