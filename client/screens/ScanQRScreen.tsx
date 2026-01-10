import { useState, useEffect, useRef } from "react";
import { View, StyleSheet, Pressable, Platform, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "ScanQR">;

function isValidAddress(data: string): { isValid: boolean; address: string } {
  const trimmed = data.trim();
  
  if (trimmed.startsWith("0x") && trimmed.length === 42) {
    return { isValid: true, address: trimmed };
  }
  
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (base58Regex.test(trimmed)) {
    return { isValid: true, address: trimmed };
  }
  
  if (trimmed.startsWith("solana:")) {
    const address = trimmed.replace("solana:", "").split("?")[0];
    if (base58Regex.test(address)) {
      return { isValid: true, address };
    }
  }
  
  if (trimmed.startsWith("ethereum:")) {
    const address = trimmed.replace("ethereum:", "").split("@")[0].split("?")[0];
    if (address.startsWith("0x") && address.length === 42) {
      return { isValid: true, address };
    }
  }
  
  return { isValid: false, address: "" };
}

export default function ScanQRScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    };
  }, []);

  const handleBarCodeScanned = async ({ data }: { data: string }) => {
    if (scanned) return;
    
    const result = isValidAddress(data);
    if (result.isValid) {
      setScanned(true);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      const routes = navigation.getState().routes;
      const previousRoute = routes[routes.length - 2];
      
      if (previousRoute?.name === "SendDetails") {
        navigation.navigate("SendDetails", {
          ...previousRoute.params,
          scannedAddress: result.address,
        } as any);
      } else {
        navigation.goBack();
      }
    }
  };

  if (!permission) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.centerContent}>
          <ThemedText>Loading camera...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (!permission.granted) {
    return (
      <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.closeButton}>
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
          <ThemedText type="h3">Scan QR Code</ThemedText>
          <View style={{ width: 24 }} />
        </View>
        
        <View style={styles.centerContent}>
          <Feather name="camera-off" size={64} color={theme.textSecondary} />
          <ThemedText type="h3" style={{ marginTop: Spacing.xl, textAlign: "center" }}>
            Camera Permission Required
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center", marginTop: Spacing.md }}>
            Allow camera access to scan wallet addresses from QR codes
          </ThemedText>
          
          {permission.status === "denied" && !permission.canAskAgain ? (
            Platform.OS !== "web" ? (
              <Button 
                style={{ marginTop: Spacing.xl }}
                onPress={async () => {
                  try {
                    await Linking.openSettings();
                  } catch {}
                }}
              >
                Open Settings
              </Button>
            ) : (
              <ThemedText type="caption" style={{ color: theme.warning, marginTop: Spacing.xl }}>
                Please enable camera in your device settings
              </ThemedText>
            )
          ) : (
            <Button style={{ marginTop: Spacing.xl }} onPress={requestPermission}>
              Enable Camera
            </Button>
          )}
        </View>
      </ThemedView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />
      
      <View style={[styles.overlay, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.closeButton}>
            <Feather name="x" size={24} color="#FFFFFF" />
          </Pressable>
          <ThemedText type="h3" style={{ color: "#FFFFFF" }}>Scan QR Code</ThemedText>
          <View style={{ width: 24 }} />
        </View>
        
        <View style={styles.scanArea}>
          <View style={styles.scanFrame}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
          </View>
        </View>
        
        <View style={[styles.instructions, { paddingBottom: insets.bottom + Spacing.xl }]}>
          <ThemedText type="body" style={{ color: "#FFFFFF", textAlign: "center" }}>
            Point your camera at a wallet address QR code
          </ThemedText>
          <ThemedText type="caption" style={{ color: "rgba(255,255,255,0.7)", textAlign: "center", marginTop: Spacing.sm }}>
            Supports Ethereum, Polygon, BNB Chain, and Solana addresses
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
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  scanArea: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  scanFrame: {
    width: 250,
    height: 250,
    position: "relative",
  },
  corner: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: "#3B82F6",
    borderWidth: 3,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: BorderRadius.md,
  },
  topRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: BorderRadius.md,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: BorderRadius.md,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: BorderRadius.md,
  },
  instructions: {
    padding: Spacing.xl,
    alignItems: "center",
  },
});
