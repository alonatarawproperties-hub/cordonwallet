import { View, StyleSheet, Modal, Pressable, ScrollView } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useEffect } from "react";

import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { Spacing, BorderRadius } from "@/constants/theme";

interface ScamExplainerModalProps {
  visible: boolean;
  address: string;
  reason: string;
  onClose: () => void;
  onProceedAnyway: () => void;
}

export function ScamExplainerModal({
  visible,
  address,
  reason,
  onClose,
  onProceedAnyway,
}: ScamExplainerModalProps) {
  const { theme } = useTheme();
  const shakeValue = useSharedValue(0);
  const pulseValue = useSharedValue(1);

  useEffect(() => {
    if (visible) {
      shakeValue.value = withSequence(
        withTiming(-5, { duration: 50 }),
        withRepeat(
          withSequence(
            withTiming(5, { duration: 100 }),
            withTiming(-5, { duration: 100 })
          ),
          3,
          true
        ),
        withTiming(0, { duration: 50 })
      );
      pulseValue.value = withRepeat(
        withSequence(
          withTiming(1.05, { duration: 800, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    }
  }, [visible, shakeValue, pulseValue]);

  const iconContainerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeValue.value }, { scale: pulseValue.value }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.modalContainer, { backgroundColor: theme.backgroundRoot }]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Animated.View style={[styles.iconContainer, { backgroundColor: theme.danger + "20" }, iconContainerStyle]}>
              <Feather name="alert-octagon" size={48} color={theme.danger} />
            </Animated.View>

            <ThemedText type="h2" style={[styles.title, { color: theme.danger }]}>
              Scam Address Detected
            </ThemedText>

            <View style={[styles.warningBox, { backgroundColor: theme.danger + "10", borderColor: theme.danger + "30" }]}>
              <Feather name="alert-triangle" size={20} color={theme.danger} />
              <ThemedText type="body" style={{ color: theme.danger, flex: 1 }}>
                This address has been flagged as malicious
              </ThemedText>
            </View>

            <View style={styles.section}>
              <ThemedText type="h4" style={{ color: theme.text }}>
                AI Analysis
              </ThemedText>
              <ThemedText type="body" style={{ color: theme.textSecondary, lineHeight: 22 }}>
                This address pattern matches known phishing and scam addresses that have been reported by the crypto community. Sending funds to this address will likely result in permanent loss.
              </ThemedText>
            </View>

            <View style={styles.section}>
              <ThemedText type="h4" style={{ color: theme.text }}>
                Detection Reason
              </ThemedText>
              <View style={[styles.reasonBox, { backgroundColor: theme.backgroundSecondary }]}>
                <ThemedText type="small" style={{ color: theme.danger }}>
                  {reason}
                </ThemedText>
              </View>
            </View>

            <View style={styles.section}>
              <ThemedText type="h4" style={{ color: theme.text }}>
                Address
              </ThemedText>
              <View style={[styles.addressBox, { backgroundColor: theme.backgroundSecondary }]}>
                <ThemedText type="small" style={{ fontFamily: "monospace", color: theme.textSecondary }}>
                  {address}
                </ThemedText>
              </View>
            </View>

            <View style={styles.section}>
              <ThemedText type="h4" style={{ color: theme.text }}>
                What This Means
              </ThemedText>
              <View style={styles.bulletList}>
                <View style={styles.bulletItem}>
                  <View style={[styles.bullet, { backgroundColor: theme.danger }]} />
                  <ThemedText type="small" style={{ color: theme.textSecondary, flex: 1 }}>
                    This address is associated with confirmed scam activity
                  </ThemedText>
                </View>
                <View style={styles.bulletItem}>
                  <View style={[styles.bullet, { backgroundColor: theme.danger }]} />
                  <ThemedText type="small" style={{ color: theme.textSecondary, flex: 1 }}>
                    Multiple users have reported losses from this address
                  </ThemedText>
                </View>
                <View style={styles.bulletItem}>
                  <View style={[styles.bullet, { backgroundColor: theme.danger }]} />
                  <ThemedText type="small" style={{ color: theme.textSecondary, flex: 1 }}>
                    Funds sent here cannot be recovered
                  </ThemedText>
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <ThemedText type="h4" style={{ color: theme.text }}>
                Recommendation
              </ThemedText>
              <ThemedText type="body" style={{ color: theme.success }}>
                Do not proceed with this transaction. If you believe this is a false positive, verify the address through official channels before sending any funds.
              </ThemedText>
            </View>
          </ScrollView>

          <View style={styles.buttonContainer}>
            <Button onPress={onClose} style={{ flex: 1 }}>
              Cancel Transaction
            </Button>
            <Pressable
              style={[styles.proceedButton, { borderColor: theme.danger + "50" }]}
              onPress={onProceedAnyway}
            >
              <ThemedText type="small" style={{ color: theme.danger }}>
                I understand the risk, proceed anyway
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  modalContainer: {
    width: "100%",
    maxHeight: "90%",
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: Spacing.lg,
  },
  title: {
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.xl,
  },
  section: {
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  reasonBox: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  addressBox: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  bulletList: {
    gap: Spacing.sm,
  },
  bulletItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
  },
  buttonContainer: {
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  proceedButton: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: "center",
  },
});
