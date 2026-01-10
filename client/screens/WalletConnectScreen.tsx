import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { useWalletConnect } from "@/lib/walletconnect/context";
import { WCSession } from "@/lib/walletconnect/client";

interface Props {
  navigation: any;
}

export default function WalletConnectScreen({ navigation }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const {
    isInitialized,
    isInitializing,
    error,
    sessions,
    connect,
    disconnect,
    refreshSessions,
  } = useWalletConnect();

  const [uriInput, setUriInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [showUriInput, setShowUriInput] = useState(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      refreshSessions();
    });
    return unsubscribe;
  }, [navigation, refreshSessions]);

  const handleScanQR = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("WCScanner");
  }, [navigation]);

  const handlePasteUri = useCallback(async () => {
    if (!uriInput.trim()) {
      Alert.alert("Error", "Please enter a WalletConnect URI");
      return;
    }

    if (!uriInput.startsWith("wc:")) {
      Alert.alert("Error", "Invalid WalletConnect URI. It should start with 'wc:'");
      return;
    }

    setIsConnecting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await connect(uriInput.trim());
      setUriInput("");
      setShowUriInput(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect";
      Alert.alert("Connection Failed", message);
    } finally {
      setIsConnecting(false);
    }
  }, [uriInput, connect]);

  const handleDisconnect = useCallback(async (session: WCSession) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Disconnect",
      `Disconnect from ${session.peerMeta.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            try {
              await disconnect(session.topic);
            } catch (err) {
              console.error("Disconnect error:", err);
            }
          },
        },
      ]
    );
  }, [disconnect]);

  const formatExpiry = (expiry: number) => {
    const date = new Date(expiry * 1000);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return "Expired";
    if (diffDays === 1) return "Expires tomorrow";
    return `Expires in ${diffDays} days`;
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {isInitializing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.accent} />
            <ThemedText type="body" style={{ marginTop: Spacing.md, color: theme.textSecondary }}>
              Initializing WalletConnect...
            </ThemedText>
          </View>
        ) : error ? (
          <Card style={styles.errorCard}>
            <Feather name="alert-circle" size={24} color={theme.danger} />
            <ThemedText type="body" style={{ color: theme.danger, marginTop: Spacing.sm }}>
              {error}
            </ThemedText>
          </Card>
        ) : (
          <>
            <View style={styles.section}>
              <ThemedText type="h3" style={{ marginBottom: Spacing.md }}>
                Connect to dApp
              </ThemedText>

              <View style={styles.connectButtons}>
                <Pressable
                  style={[styles.connectButton, { backgroundColor: theme.accent }]}
                  onPress={handleScanQR}
                >
                  <Feather name="camera" size={24} color="#FFFFFF" />
                  <ThemedText type="body" style={{ color: "#FFFFFF", marginLeft: Spacing.sm, fontWeight: "600" }}>
                    Scan QR Code
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={[styles.connectButton, { backgroundColor: theme.backgroundDefault, borderColor: theme.border, borderWidth: 1 }]}
                  onPress={() => setShowUriInput(!showUriInput)}
                >
                  <Feather name="clipboard" size={24} color={theme.text} />
                  <ThemedText type="body" style={{ marginLeft: Spacing.sm, fontWeight: "600" }}>
                    Paste URI
                  </ThemedText>
                </Pressable>
              </View>

              {showUriInput ? (
                <View style={styles.uriInputContainer}>
                  <TextInput
                    style={[
                      styles.uriInput,
                      {
                        backgroundColor: theme.backgroundDefault,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                    placeholder="wc:..."
                    placeholderTextColor={theme.textSecondary}
                    value={uriInput}
                    onChangeText={setUriInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                  />
                  <Button
                    onPress={handlePasteUri}
                    disabled={isConnecting || !uriInput.trim()}
                    style={{ marginTop: Spacing.sm }}
                  >
                    {isConnecting ? "Connecting..." : "Connect"}
                  </Button>
                </View>
              ) : null}
            </View>

            <View style={styles.section}>
              <ThemedText type="h3" style={{ marginBottom: Spacing.md }}>
                Connected dApps
              </ThemedText>

              {sessions.length === 0 ? (
                <Card style={styles.emptyCard}>
                  <Feather name="link-2" size={32} color={theme.textSecondary} />
                  <ThemedText
                    type="body"
                    style={{ color: theme.textSecondary, marginTop: Spacing.md, textAlign: "center" }}
                  >
                    No connected dApps.{"\n"}Scan a QR code to connect.
                  </ThemedText>
                </Card>
              ) : (
                sessions.map((session) => (
                  <Card key={session.topic} style={styles.sessionCard}>
                    <View style={styles.sessionHeader}>
                      <View style={styles.sessionInfo}>
                        <ThemedText type="body" style={{ fontWeight: "600" }}>
                          {session.peerMeta.name}
                        </ThemedText>
                        <ThemedText type="small" style={{ color: theme.textSecondary }}>
                          {session.peerMeta.url.replace(/^https?:\/\//, "")}
                        </ThemedText>
                        <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: Spacing.xs }}>
                          {formatExpiry(session.expiry)}
                        </ThemedText>
                      </View>
                      <Pressable
                        style={[styles.disconnectButton, { borderColor: theme.danger }]}
                        onPress={() => handleDisconnect(session)}
                      >
                        <Feather name="x" size={16} color={theme.danger} />
                      </Pressable>
                    </View>
                  </Card>
                ))
              )}
            </View>

            <View style={styles.section}>
              <View style={[styles.infoCard, { backgroundColor: theme.accent + "15" }]}>
                <Feather name="shield" size={20} color={theme.accent} />
                <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                  <ThemedText type="small" style={{ fontWeight: "600" }}>
                    Wallet Firewall Active
                  </ThemedText>
                  <ThemedText type="small" style={{ color: theme.textSecondary, marginTop: 2 }}>
                    All transactions are screened. Unlimited approvals are blocked by default.
                  </ThemedText>
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
  },
  errorCard: {
    padding: Spacing.lg,
    alignItems: "center",
    borderWidth: 1,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  connectButtons: {
    gap: Spacing.md,
  },
  connectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
    borderRadius: 12,
  },
  uriInputContainer: {
    marginTop: Spacing.md,
  },
  uriInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.md,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: "top",
  },
  emptyCard: {
    padding: Spacing.xl,
    alignItems: "center",
  },
  sessionCard: {
    marginBottom: Spacing.sm,
  },
  sessionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  sessionInfo: {
    flex: 1,
  },
  disconnectButton: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: 12,
  },
});
