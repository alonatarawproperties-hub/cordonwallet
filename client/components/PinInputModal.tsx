import { useState, useRef, useEffect } from "react";
import { View, StyleSheet, TextInput, Pressable, Modal, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
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
  step?: string;
  loading?: boolean;
  loadingMessage?: string;
}

export function PinInputModal({ visible, title, message, onSubmit, onCancel, error, step, loading, loadingMessage = "Processing..." }: PinInputModalProps) {
  const { theme } = useTheme();
  const [pin, setPin] = useState("");
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setPin("");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible, step]);

  const focusInput = () => {
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [error]);

  const handlePinChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, "").slice(0, 6);
    setPin(numericValue);
    
    if (numericValue.length === 6) {
      setTimeout(() => onSubmit(numericValue), 150);
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
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.accent} />
                <ThemedText type="body" style={[styles.loadingText, { color: theme.textSecondary }]}>
                  {loadingMessage}
                </ThemedText>
              </View>
            ) : (
              <>
                <ThemedText type="h3" style={styles.title}>{title}</ThemedText>
                <ThemedText type="body" style={[styles.message, { color: theme.textSecondary }]}>
                  {message}
                </ThemedText>

                <Pressable 
                  style={[styles.pinContainer, { backgroundColor: theme.backgroundRoot, borderColor: error ? theme.danger : theme.border }]}
                  onPress={focusInput}
                >
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
                </Pressable>

                {error ? (
                  <ThemedText type="caption" style={[styles.error, { color: theme.danger }]}>
                    {error}
                  </ThemedText>
                ) : null}

                <Pressable
                  style={[styles.cancelButton, { backgroundColor: theme.backgroundRoot }]}
                  onPress={handleCancel}
                >
                  <ThemedText type="body" style={{ fontWeight: "600" }}>Cancel</ThemedText>
                </Pressable>
              </>
            )}
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
  cancelButton: {
    width: "100%",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    marginTop: Spacing.sm,
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.xl,
  },
  loadingText: {
    marginTop: Spacing.lg,
  },
});
