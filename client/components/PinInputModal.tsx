import { useState, useRef, useEffect } from "react";
import { View, StyleSheet, TextInput, Pressable, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";

interface PinInputModalProps {
  visible: boolean;
  title: string;
  message: string;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
  error?: string | null;
}

export function PinInputModal({ visible, title, message, onSubmit, onCancel, error }: PinInputModalProps) {
  const { theme } = useTheme();
  const [pin, setPin] = useState("");
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setPin("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  useEffect(() => {
    if (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [error]);

  const handlePinChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, "").slice(0, 6);
    setPin(numericValue);
  };

  const handleSubmit = () => {
    if (pin.length === 6) {
      onSubmit(pin);
    }
  };

  const handleCancel = () => {
    setPin("");
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <BlurView intensity={40} tint="dark" style={styles.overlay}>
        <KeyboardAvoidingView 
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.container}
        >
          <View style={[styles.modal, { backgroundColor: theme.backgroundDefault }]}>
            <ThemedText type="h3" style={styles.title}>{title}</ThemedText>
            <ThemedText type="body" style={[styles.message, { color: theme.textSecondary }]}>
              {message}
            </ThemedText>

            <View style={[styles.pinContainer, { backgroundColor: theme.backgroundRoot, borderColor: error ? theme.danger : theme.border }]}>
              <View style={styles.dotsContainer}>
                {[...Array(6)].map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      {
                        backgroundColor: i < pin.length ? theme.accent : theme.border,
                      },
                    ]}
                  />
                ))}
              </View>
              <TextInput
                ref={inputRef}
                style={styles.hiddenInput}
                value={pin}
                onChangeText={handlePinChange}
                keyboardType="number-pad"
                maxLength={6}
                secureTextEntry
                autoFocus
              />
            </View>

            {error ? (
              <ThemedText type="caption" style={[styles.error, { color: theme.danger }]}>
                {error}
              </ThemedText>
            ) : null}

            <View style={styles.buttons}>
              <Pressable
                style={[styles.button, { backgroundColor: theme.backgroundRoot }]}
                onPress={handleCancel}
              >
                <ThemedText type="body" style={{ fontWeight: "600" }}>Cancel</ThemedText>
              </Pressable>
              <Pressable
                style={[
                  styles.button,
                  { backgroundColor: pin.length === 6 ? theme.accent : theme.border },
                ]}
                onPress={handleSubmit}
                disabled={pin.length !== 6}
              >
                <ThemedText type="body" style={{ fontWeight: "600", color: pin.length === 6 ? "#fff" : theme.textSecondary }}>
                  OK
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  modal: {
    width: "100%",
    maxWidth: 340,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: Spacing.sm,
  },
  message: {
    marginBottom: Spacing.lg,
  },
  pinContainer: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  dotsContainer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.md,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    width: "100%",
    height: "100%",
  },
  error: {
    marginBottom: Spacing.md,
    textAlign: "center",
  },
  buttons: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  button: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
});
