import { useState, useRef, useEffect } from "react";
import { View, StyleSheet, TextInput, Pressable, Alert, Image } from "react-native";
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
import { unlockWithPin, verifyPin, VaultCorruptedError, repairCorruptedVault } from "@/lib/wallet-engine";
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
  const inputRef = useRef<TextInput>(null);

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
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      
      if (hasHardware && isEnrolled) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: "Unlock Cordon",
          fallbackLabel: "Use PIN",
          cancelLabel: "Cancel",
        });
        
        if (result.success) {
          handleBiometricSuccess();
        }
      }
    } catch (error) {
      console.log("Biometric not available");
    }
  };

  const handleBiometricSuccess = async () => {
    unlock();
    await refreshWallets();
    navigation.reset({
      index: 0,
      routes: [{ name: "Main" }],
    });
  };

  const handlePinChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, "").slice(0, PIN_LENGTH);
    setPin(numericValue);
    
    if (numericValue.length === PIN_LENGTH) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setTimeout(() => handleUnlock(numericValue), 200);
    }
  };

  const handleUnlock = async (enteredPin: string) => {
    setIsUnlocking(true);
    
    try {
      const success = await unlockWithPin(enteredPin);
      
      if (success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        unlock();
        await refreshWallets();
        navigation.reset({
          index: 0,
          routes: [{ name: "Main" }],
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
          source={require("../../assets/images/icon.png")}
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

        <Pressable 
          style={styles.inputArea} 
          onPress={() => inputRef.current?.focus()}
        >
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Tap here if keyboard disappeared
          </ThemedText>
        </Pressable>

        <Pressable style={styles.biometricButton} onPress={tryBiometric}>
          <View style={[styles.biometricIcon, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="smartphone" size={24} color={theme.accent} />
          </View>
          <ThemedText type="small" style={{ color: theme.accent }}>
            Use Biometrics
          </ThemedText>
        </Pressable>
      </View>

      {isUnlocking && (
        <View style={styles.processingOverlay}>
          <ThemedText type="body">Unlocking...</ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing["2xl"],
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing["2xl"],
  },
  title: {
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
    marginBottom: Spacing["3xl"],
  },
  dotsContainer: {
    flexDirection: "row",
    gap: Spacing.lg,
    marginBottom: Spacing["2xl"],
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
  hiddenInput: {
    position: "absolute",
    opacity: 0.01,
    height: 1,
    width: 1,
    left: -9999,
  },
  inputArea: {
    padding: Spacing.lg,
    marginBottom: Spacing["2xl"],
  },
  biometricButton: {
    alignItems: "center",
    gap: Spacing.sm,
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
