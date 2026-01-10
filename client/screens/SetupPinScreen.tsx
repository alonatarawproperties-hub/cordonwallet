import { useState, useRef, useEffect } from "react";
import { View, StyleSheet, TextInput, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useWallet } from "@/lib/wallet-context";
import { createWallet } from "@/lib/wallet-engine";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "SetupPin">;

const PIN_LENGTH = 6;

export default function SetupPinScreen({ navigation, route }: Props) {
  const { mnemonic, walletName, isImport, walletType = "multi-chain" } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { addWallet, unlock } = useWallet();
  
  const [step, setStep] = useState<"create" | "confirm">("create");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [step]);

  const handlePinChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, "").slice(0, PIN_LENGTH);
    
    if (step === "create") {
      setPin(numericValue);
      if (numericValue.length === PIN_LENGTH) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setTimeout(() => {
          setStep("confirm");
          setConfirmPin("");
        }, 200);
      }
    } else {
      setConfirmPin(numericValue);
      if (numericValue.length === PIN_LENGTH) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setTimeout(() => handleConfirm(numericValue), 200);
      }
    }
  };

  const handleConfirm = async (enteredConfirmPin: string) => {
    if (enteredConfirmPin !== pin) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("PIN Mismatch", "The PINs do not match. Please try again.", [
        { text: "OK", onPress: () => {
          setStep("create");
          setPin("");
          setConfirmPin("");
        }}
      ]);
      return;
    }

    setIsProcessing(true);

    try {
      const wallet = await createWallet(mnemonic, walletName, pin, walletType);
      
      await addWallet({
        id: wallet.id,
        name: wallet.name,
        address: wallet.address,
        addresses: wallet.addresses,
        walletType: wallet.walletType,
        createdAt: wallet.createdAt,
      });
      
      unlock();

      const seedPhrase = mnemonic.split(" ");
      
      if (isImport) {
        navigation.reset({
          index: 0,
          routes: [{ name: "Main" }],
        });
      } else {
        navigation.navigate("BackupWarning", { seedPhrase, walletId: wallet.id });
      }
    } catch (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", "Failed to create wallet. Please try again.");
      setStep("create");
      setPin("");
      setConfirmPin("");
    } finally {
      setIsProcessing(false);
    }
  };

  const currentPin = step === "create" ? pin : confirmPin;

  return (
    <ThemedView style={[styles.container, { paddingTop: headerHeight + Spacing["2xl"], paddingBottom: insets.bottom + Spacing["2xl"] }]}>
      <View style={styles.content}>
        <View style={[styles.iconContainer, { backgroundColor: theme.accent + "20" }]}>
          <Feather name="lock" size={40} color={theme.accent} />
        </View>

        <ThemedText type="h2" style={styles.title}>
          {step === "create" ? "Create Your PIN" : "Confirm Your PIN"}
        </ThemedText>
        <ThemedText type="body" style={[styles.subtitle, { color: theme.textSecondary }]}>
          {step === "create" 
            ? "Enter a 6-digit PIN to secure your wallet"
            : "Re-enter your PIN to confirm"
          }
        </ThemedText>

        <View style={styles.dotsContainer}>
          {Array.from({ length: PIN_LENGTH }).map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                { 
                  backgroundColor: index < currentPin.length 
                    ? theme.accent 
                    : theme.backgroundDefault,
                  borderColor: theme.border,
                },
              ]}
            />
          ))}
        </View>

        <TextInput
          key={step}
          ref={inputRef}
          value={currentPin}
          onChangeText={handlePinChange}
          keyboardType="number-pad"
          maxLength={PIN_LENGTH}
          style={styles.hiddenInput}
          autoFocus
          editable={!isProcessing}
          testID="pin-input"
        />

        <Pressable 
          style={styles.inputArea} 
          onPress={() => inputRef.current?.focus()}
        >
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            Tap here if keyboard disappeared
          </ThemedText>
        </Pressable>
      </View>

      {step === "confirm" && (
        <View style={styles.footer}>
          <Button 
            onPress={() => {
              setStep("create");
              setPin("");
              setConfirmPin("");
            }}
            style={{ backgroundColor: "transparent" }}
          >
            <ThemedText style={{ color: theme.accent }}>Start Over</ThemedText>
          </Button>
        </View>
      )}

      {isProcessing && (
        <View style={styles.processingOverlay}>
          <ThemedText type="body">Creating your wallet...</ThemedText>
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
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
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
  },
  footer: {
    alignItems: "center",
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
});
