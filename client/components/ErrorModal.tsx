import React from "react";
import {
  View,
  Modal,
  Pressable,
  StyleSheet,
} from "react-native";
import { BlurView } from "expo-blur";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "./ThemedText";
import { Button } from "./Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";

export interface ErrorModalProps {
  visible: boolean;
  title: string;
  message: string;
  icon?: keyof typeof Feather.glyphMap;
  iconColor?: string;
  onClose: () => void;
  onAction?: () => void;
  actionLabel?: string;
  closeLabel?: string;
}

export function ErrorModal({
  visible,
  title,
  message,
  icon = "alert-circle",
  iconColor,
  onClose,
  onAction,
  actionLabel,
  closeLabel = "OK",
}: ErrorModalProps) {
  const theme = useTheme();
  const finalIconColor = iconColor || theme.danger;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <BlurView intensity={40} tint="dark" style={styles.backdrop}>
        <Pressable style={styles.backdropPressable} onPress={onClose}>
          <View />
        </Pressable>
        
        <View style={[styles.container, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[styles.iconCircle, { backgroundColor: finalIconColor + "20" }]}>
            <Feather name={icon} size={32} color={finalIconColor} />
          </View>
          
          <ThemedText type="h3" style={styles.title}>
            {title}
          </ThemedText>
          
          <ThemedText type="body" style={[styles.message, { color: theme.textSecondary }]}>
            {message}
          </ThemedText>
          
          <View style={styles.buttons}>
            {onAction ? (
              <>
                <Pressable
                  style={[styles.secondaryButton, { borderColor: theme.border }]}
                  onPress={onClose}
                >
                  <ThemedText type="body" style={{ fontWeight: "600" }}>
                    {closeLabel}
                  </ThemedText>
                </Pressable>
                <Button onPress={onAction} style={{ flex: 1 }}>
                  {actionLabel || "Continue"}
                </Button>
              </>
            ) : (
              <Button onPress={onClose} style={{ flex: 1 }}>
                {closeLabel}
              </Button>
            )}
          </View>
        </View>
      </BlurView>
    </Modal>
  );
}

export interface TransferBlockedModalProps {
  visible: boolean;
  title: string;
  message: string;
  onClose: () => void;
}

export function TransferBlockedModal({
  visible,
  title,
  message,
  onClose,
}: TransferBlockedModalProps) {
  return (
    <ErrorModal
      visible={visible}
      title={title}
      message={message}
      icon="lock"
      onClose={onClose}
      closeLabel="I Understand"
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  backdropPressable: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  container: {
    width: "100%",
    maxWidth: 360,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: "center",
    gap: Spacing.lg,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    textAlign: "center",
  },
  message: {
    textAlign: "center",
    lineHeight: 22,
  },
  buttons: {
    flexDirection: "row",
    gap: Spacing.md,
    width: "100%",
    marginTop: Spacing.md,
  },
  secondaryButton: {
    flex: 1,
    padding: Spacing.lg,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
