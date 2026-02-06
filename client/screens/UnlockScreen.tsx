import { useState, useRef, useEffect, memo } from "react";
import { View, StyleSheet, TextInput, Pressable, Alert, Image, Keyboard, Platform, Dimensions, InteractionManager } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  Easing,
  cancelAnimation,
  type SharedValue,
} from "react-native-reanimated";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useWallet } from "@/lib/wallet-context";
import { unlockWithPin, unlockWithCachedKey, verifyPin, VaultCorruptedError, repairCorruptedVault, getPinWithBiometrics, hasBiometricPinEnabled, savePinForBiometrics, getActiveWallet } from "@/lib/wallet-engine";
import { prefetchPortfolioCache } from "@/lib/portfolio-cache";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Unlock">;

const PIN_LENGTH = 6;

/* ── Animated dot with traveling wave effect ── */
const AnimatedDot = memo(function AnimatedDot({
  index,
  filled,
  waveProgress,
  unlockingAnim,
  accentColor,
  defaultBgColor,
  borderColor,
}: {
  index: number;
  filled: boolean;
  waveProgress: SharedValue<number>;
  unlockingAnim: SharedValue<number>;
  accentColor: string;
  defaultBgColor: string;
  borderColor: string;
}) {
  const animStyle = useAnimatedStyle(() => {
    "worklet";
    const offset = index / PIN_LENGTH;
    const wave = Math.sin((waveProgress.value - offset) * 2 * Math.PI);
    const bounce = Math.max(0, wave) * 0.4;
    const scale = 1 + bounce * unlockingAnim.value;
    return { transform: [{ scale }] };
  });

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          backgroundColor: filled ? accentColor : defaultBgColor,
          borderColor: filled ? accentColor : borderColor,
        },
        animStyle,
      ]}
    />
  );
});

export default function UnlockScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { unlock, refreshWallets, resetWalletState } = useWallet();

  const [pin, setPin] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);

  /* ── Animation shared values ── */
  const waveProgress = useSharedValue(0);
  const unlockingAnim = useSharedValue(0);
  const overlayOpacity = useSharedValue(0);
  const glowScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0);
  const ripple1Progress = useSharedValue(0);
  const ripple2Progress = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const iconScale = useSharedValue(1);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    const init = async () => {
      setTimeout(() => inputRef.current?.focus(), 100);
      const hasVault = await import("@/lib/wallet-engine").then(m => m.hasVault());
      if (hasVault) {
        tryBiometric();
      }
    };
    init();
  }, []);

  /* ── Drive animations from isUnlocking state ── */
  useEffect(() => {
    if (isUnlocking) {
      // Dot wave
      unlockingAnim.value = withTiming(1, { duration: 300 });
      waveProgress.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.linear }),
        -1
      );

      // Overlay fade in
      overlayOpacity.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.ease) });

      // Central glow pulse
      glowOpacity.value = withTiming(0.4, { duration: 500 });
      glowScale.value = withRepeat(
        withSequence(
          withTiming(1.25, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.85, { duration: 1200, easing: Easing.inOut(Easing.ease) })
        ),
        -1, true
      );

      // Expanding ripple rings
      ripple1Progress.value = withRepeat(
        withTiming(1, { duration: 2200, easing: Easing.out(Easing.cubic) }),
        -1
      );
      ripple2Progress.value = withDelay(1100, withRepeat(
        withTiming(1, { duration: 2200, easing: Easing.out(Easing.cubic) }),
        -1
      ));

      // Icon breathe
      iconScale.value = withRepeat(
        withSequence(
          withTiming(1.08, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.95, { duration: 1400, easing: Easing.inOut(Easing.ease) })
        ),
        -1, true
      );

      // Text pulse
      textOpacity.value = withDelay(200, withRepeat(
        withSequence(
          withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 1200, easing: Easing.inOut(Easing.ease) })
        ),
        -1, true
      ));
    } else {
      // Reset all animations
      unlockingAnim.value = withTiming(0, { duration: 200 });
      cancelAnimation(waveProgress);
      waveProgress.value = 0;
      overlayOpacity.value = withTiming(0, { duration: 200 });
      glowOpacity.value = withTiming(0, { duration: 200 });
      cancelAnimation(glowScale);
      glowScale.value = 1;
      cancelAnimation(ripple1Progress);
      cancelAnimation(ripple2Progress);
      ripple1Progress.value = 0;
      ripple2Progress.value = 0;
      cancelAnimation(iconScale);
      iconScale.value = 1;
      textOpacity.value = withTiming(0, { duration: 200 });
    }
  }, [isUnlocking]);

  /* ── Animated styles ── */
  const overlayAnimStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const glowAnimStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: glowScale.value }],
  }));

  const ripple1Style = useAnimatedStyle(() => ({
    transform: [{ scale: ripple1Progress.value * 3 }],
    opacity: (1 - ripple1Progress.value) * 0.5,
  }));

  const ripple2Style = useAnimatedStyle(() => ({
    transform: [{ scale: ripple2Progress.value * 3 }],
    opacity: (1 - ripple2Progress.value) * 0.35,
  }));

  const iconAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  const textAnimStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
  }));

  const tryBiometric = async () => {
    try {
      const hasBiometricEnabled = await hasBiometricPinEnabled();
      if (!hasBiometricEnabled) {
        console.log("Biometric unlock not enabled for this wallet");
        return;
      }

      // First try fast unlock with cached key (instant, no PBKDF2)
      setIsUnlocking(true);

      // Trigger biometric prompt by attempting to get PIN from secure storage
      const pin = await getPinWithBiometrics();
      if (!pin) {
        setIsUnlocking(false);
        return;
      }

      // Try fast path with cached key first
      let success = await unlockWithCachedKey();

      // Fall back to PIN verification if cached key unavailable
      if (!success) {
        success = await unlockWithPin(pin);
      }

      if (success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        unlock();

        // Navigate immediately for instant response
        navigation.reset({
          index: 0,
          routes: [{ name: "Main" }],
        });

        // Background tasks - don't block navigation
        getActiveWallet().then(wallet => {
          if (wallet) {
            const evmAddr = wallet.addresses?.evm || wallet.address;
            const solAddr = wallet.addresses?.solana;
            prefetchPortfolioCache(evmAddr, solAddr);
          }
        });
        refreshWallets();
      } else {
        setIsUnlocking(false);
      }
    } catch (error) {
      console.log("Biometric unlock failed:", error);
      setIsUnlocking(false);
    }
  };

  const handlePinChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, "").slice(0, PIN_LENGTH);
    setPin(numericValue);

    if (numericValue.length === PIN_LENGTH) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Unlock immediately without artificial delay
      handleUnlock(numericValue);
    }
  };

  const handleUnlock = async (enteredPin: string) => {
    setIsUnlocking(true);

    // Allow UI to render the loading state before starting heavy PBKDF2 work
    await new Promise(resolve => InteractionManager.runAfterInteractions(resolve));

    try {
      const success = await unlockWithPin(enteredPin);

      if (success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        unlock();

        // Start prefetching portfolio data immediately (don't await)
        getActiveWallet().then(wallet => {
          if (wallet) {
            const evmAddr = wallet.addresses?.evm || wallet.address;
            const solAddr = wallet.addresses?.solana;
            prefetchPortfolioCache(evmAddr, solAddr);
          }
        });

        // Navigate immediately for instant response
        navigation.reset({
          index: 0,
          routes: [{ name: "Main" }],
        });
        // Background tasks - don't block navigation
        refreshWallets();
        hasBiometricPinEnabled().then(hasBiometric => {
          if (!hasBiometric) {
            savePinForBiometrics(enteredPin);
          }
        });
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setAttempts(prev => prev + 1);
        setPin("");

        if (attempts >= 4) {
          Alert.alert(
            "Too Many Attempts",
            "You have entered the wrong PIN too many times. Please try again later.",
            [{ text: "OK" }]
          );
        } else {
          Alert.alert("Incorrect PIN", "Please try again.");
        }
      }
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPin("");

      if (error instanceof VaultCorruptedError) {
        Alert.alert(
          "Wallet Data Corrupted",
          "Your wallet data appears to be corrupted. You can restore your wallet using your backup seed phrase.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Reset & Restore",
              style: "destructive",
              onPress: async () => {
                await repairCorruptedVault();
                resetWalletState();
                navigation.reset({
                  index: 0,
                  routes: [{ name: "Welcome" }],
                });
              },
            },
          ]
        );
      } else {
        Alert.alert("Error", "Failed to unlock. Please try again.");
      }
    } finally {
      setIsUnlocking(false);
    }
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top + Spacing["3xl"], paddingBottom: insets.bottom + Spacing["2xl"] }]}>
      <View style={styles.content}>
        <Image
          source={require("../../assets/images/cordon-logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />

        <ThemedText type="h2" style={styles.title}>
          Welcome Back
        </ThemedText>
        <ThemedText type="body" style={[styles.subtitle, { color: theme.textSecondary }]}>
          Enter your PIN to unlock Cordon
        </ThemedText>

        <View style={styles.dotsContainer}>
          {Array.from({ length: PIN_LENGTH }).map((_, index) => (
            <AnimatedDot
              key={index}
              index={index}
              filled={index < pin.length}
              waveProgress={waveProgress}
              unlockingAnim={unlockingAnim}
              accentColor={theme.accent}
              defaultBgColor={theme.backgroundDefault}
              borderColor={theme.border}
            />
          ))}
        </View>

        <TextInput
          ref={inputRef}
          value={pin}
          onChangeText={handlePinChange}
          keyboardType="number-pad"
          maxLength={PIN_LENGTH}
          style={styles.hiddenInput}
          autoFocus
          editable={!isUnlocking}
        />

        {!keyboardVisible && (
          <Pressable
            style={styles.inputArea}
            onPress={() => {
              inputRef.current?.blur();
              setTimeout(() => inputRef.current?.focus(), 100);
            }}
          >
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Tap here if keyboard disappeared
            </ThemedText>
          </Pressable>
        )}

        {!keyboardVisible && (
          <Pressable style={styles.biometricButton} onPress={tryBiometric}>
            <View style={[styles.biometricIcon, { backgroundColor: theme.backgroundDefault }]}>
              <Feather name="smartphone" size={24} color={theme.accent} />
            </View>
            <ThemedText type="small" style={{ color: theme.accent }}>
              Use Biometrics
            </ThemedText>
          </Pressable>
        )}
      </View>

      {/* ── Unlock animation overlay ── */}
      {isUnlocking && (
        <Animated.View style={[styles.animOverlay, overlayAnimStyle]}>
          {/* Expanding ripple rings */}
          <Animated.View
            style={[styles.rippleRing, { borderColor: theme.accent }, ripple1Style]}
          />
          <Animated.View
            style={[styles.rippleRing, { borderColor: theme.accent }, ripple2Style]}
          />

          {/* Pulsing glow orb */}
          <Animated.View
            style={[styles.glowOrb, { backgroundColor: theme.accent }, glowAnimStyle]}
          />

          {/* Shield icon */}
          <Animated.View style={iconAnimStyle}>
            <Feather name="shield" size={52} color={theme.accent} />
          </Animated.View>

          {/* Unlocking text */}
          <Animated.View style={[styles.unlockTextWrap, textAnimStyle]}>
            <ThemedText type="h4" style={{ color: "#FFFFFF" }}>
              Unlocking...
            </ThemedText>
          </Animated.View>
        </Animated.View>
      )}
    </ThemedView>
  );
}

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing["2xl"],
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: SCREEN_HEIGHT * 0.15,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.xs,
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
    marginBottom: Spacing["2xl"],
  },
  dotsContainer: {
    flexDirection: "row",
    gap: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    height: 1,
    width: 1,
  },
  inputArea: {
    padding: Spacing.md,
    marginTop: Spacing.lg,
  },
  biometricButton: {
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.xl,
  },
  biometricIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  /* ── Unlock animation overlay ── */
  animOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 14, 19, 0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  rippleRing: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
  },
  glowOrb: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  unlockTextWrap: {
    marginTop: Spacing["2xl"],
  },
});
