import { useState, useCallback, createContext, useContext, ReactNode } from "react";
import { View, StyleSheet, Modal, Pressable } from "react-native";
import { BlurView } from "expo-blur";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";

interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
}

interface AlertConfig {
  title: string;
  message?: string;
  buttons?: AlertButton[];
}

interface ThemedAlertContextType {
  showAlert: (title: string, message?: string, buttons?: AlertButton[]) => void;
}

const ThemedAlertContext = createContext<ThemedAlertContextType | null>(null);

export function useThemedAlert() {
  const context = useContext(ThemedAlertContext);
  if (!context) {
    throw new Error("useThemedAlert must be used within ThemedAlertProvider");
  }
  return context;
}

interface ThemedAlertProviderProps {
  children: ReactNode;
}

export function ThemedAlertProvider({ children }: ThemedAlertProviderProps) {
  const { theme } = useTheme();
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<AlertConfig | null>(null);

  const showAlert = useCallback((title: string, message?: string, buttons?: AlertButton[]) => {
    setConfig({ title, message, buttons: buttons || [{ text: "OK" }] });
    setVisible(true);
  }, []);

  const handleButtonPress = useCallback((button: AlertButton) => {
    setVisible(false);
    setTimeout(() => {
      button.onPress?.();
      setConfig(null);
    }, 150);
  }, []);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setConfig(null);
  }, []);

  return (
    <ThemedAlertContext.Provider value={{ showAlert }}>
      {children}
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={handleDismiss}
      >
        <View style={styles.overlay}>
          <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[styles.alertContainer, { backgroundColor: theme.backgroundSecondary }]}>
            <View style={styles.contentContainer}>
              <ThemedText type="h3" style={styles.title}>
                {config?.title}
              </ThemedText>
              {config?.message ? (
                <ThemedText type="body" style={[styles.message, { color: theme.textSecondary }]}>
                  {config.message}
                </ThemedText>
              ) : null}
            </View>
            <View style={[styles.buttonContainer, { borderTopColor: theme.border }]}>
              {config?.buttons?.map((button, index) => {
                const isDestructive = button.style === "destructive";
                const isCancel = button.style === "cancel";
                const buttonColor = isDestructive 
                  ? theme.danger 
                  : isCancel 
                    ? theme.textSecondary 
                    : theme.accent;
                
                return (
                  <Pressable
                    key={index}
                    style={({ pressed }) => [
                      styles.button,
                      index > 0 && { borderLeftWidth: 1, borderLeftColor: theme.border },
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={() => handleButtonPress(button)}
                  >
                    <ThemedText 
                      type="body" 
                      style={[
                        styles.buttonText, 
                        { color: buttonColor },
                        isCancel && styles.cancelText,
                      ]}
                    >
                      {button.text}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </ThemedAlertContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  alertContainer: {
    width: "85%",
    maxWidth: 320,
    borderRadius: BorderRadius.xl,
    overflow: "hidden",
  },
  contentContainer: {
    padding: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  message: {
    textAlign: "center",
    lineHeight: 22,
  },
  buttonContainer: {
    flexDirection: "row",
    borderTopWidth: 1,
  },
  button: {
    flex: 1,
    paddingVertical: Spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPressed: {
    opacity: 0.6,
  },
  buttonText: {
    fontWeight: "600",
    fontSize: 16,
  },
  cancelText: {
    fontWeight: "400",
  },
});
