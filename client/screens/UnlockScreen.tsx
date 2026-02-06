import { useState, useRef, useEffect } from "react";
import { View, StyleSheet, TextInput, Pressable, Alert, Image, Keyboard, Platform, Dimensions, InteractionManager } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";

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

export default function UnlockScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const { unlock, refreshWallets, resetWalletState } = useWallet();
  
  const [pin, setPin] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);

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
            <View
              key={index}
              style={[
                styles.dot,
                { 
                  backgroundColor: index < pin.length 
                    ? theme.accent 
                    : theme.backgroundDefault,
                  borderColor: theme.border,
                },
              ]}
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

      {isUnlocking && (
        <View style={styles.processingOverlay}>
          <ThemedText type="body">Unlocking...</ThemedText>
        </View>
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
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
});
