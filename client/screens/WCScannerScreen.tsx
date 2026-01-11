import React, { useState, useCallback } from "react";
import { View, StyleSheet, Alert, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { useWalletConnect } from "@/lib/walletconnect/context";

interface Props {
  navigation: any;
}

export default function WCScannerScreen({ navigation }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const { connect } = useWalletConnect();

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (!isScanning || isConnecting) return;

      if (!data.startsWith("wc:")) {
        return;
      }

      setIsScanning(false);
      setIsConnecting(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      try {
        await connect(data);
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate("WalletConnect");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to connect";
        Alert.alert("Connection Failed", message, [
          {
            text: "Try Again",
            onPress: () => {
              setIsScanning(true);
              setIsConnecting(false);
            },
          },
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.navigate("WalletConnect");
              }
            },
          },
        ]);
      }
    },
    [isScanning, isConnecting, connect, navigation]
  );

  const handleClose = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate("WalletConnect");
    }
  }, [navigation]);

  if (!permission) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centered, { paddingTop: insets.top + Spacing.xl }]}>
          <ThemedText type="body">Loading camera...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (!permission.granted) {
    return (
      <ThemedView style={styles.container}>
        <View style={[styles.centered, { paddingTop: insets.top + Spacing.xl }]}>
          <Feather name="camera-off" size={48} color={theme.textSecondary} />
          <ThemedText type="h3" style={{ marginTop: Spacing.lg, textAlign: "center" }}>
            Camera Permission Required
          </ThemedText>
          <ThemedText
            type="body"
            style={{ color: theme.textSecondary, marginTop: Spacing.md, textAlign: "center", paddingHorizontal: Spacing.xl }}
          >
            To scan WalletConnect QR codes, please grant camera access.
          </ThemedText>
          <Button onPress={requestPermission} style={{ marginTop: Spacing.xl }}>
            Grant Permission
          </Button>
          <Pressable onPress={handleClose} style={{ marginTop: Spacing.md, padding: Spacing.md }}>
            <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>
              Cancel
            </ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
        onBarcodeScanned={handleBarCodeScanned}
      />

      <View style={[styles.overlay, { paddingTop: insets.top }]}>
        <Pressable style={styles.closeButton} onPress={handleClose}>
          <Feather name="x" size={24} color="#FFFFFF" />
        </Pressable>

        <View style={styles.scanArea}>
          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
        </View>

        <View style={[styles.instructions, { paddingBottom: insets.bottom + Spacing.xl }]}>
          <ThemedText type="body" style={{ color: "#FFFFFF", textAlign: "center", fontWeight: "600" }}>
            {isConnecting ? "Connecting..." : "Scan WalletConnect QR Code"}
          </ThemedText>
          <ThemedText type="small" style={{ color: "rgba(255,255,255,0.7)", textAlign: "center", marginTop: Spacing.xs }}>
            Position the QR code within the frame
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  closeButton: {
    position: "absolute",
    top: 60,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  scanArea: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scanFrame: {
    width: 280,
    height: 280,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 40,
    height: 40,
    borderColor: "#3B82F6",
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 16,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 16,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 16,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 16,
  },
  instructions: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    alignItems: "center",
  },
});
