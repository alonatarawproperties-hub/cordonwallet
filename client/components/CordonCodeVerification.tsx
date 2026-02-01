import { useState, useRef } from "react";
import { View, StyleSheet, TextInput, Pressable, ActivityIndicator, Keyboard } from "react-native";
import * as SecureStore from "expo-secure-store";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { Feather } from "@expo/vector-icons";
import { getApiUrl, getApiHeaders } from "@/lib/query-client";

const CORDON_JWT_KEY = "cordon_auth_jwt";
const CORDON_USER_KEY = "cordon_auth_user";

interface CordonCodeVerificationProps {
  onSuccess: (user: { email: string; name: string }, jwt: string) => void;
  onCancel: () => void;
}

export function CordonCodeVerification({ onSuccess, onCancel }: CordonCodeVerificationProps) {
  const { theme } = useTheme();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const handleVerify = async () => {
    if (code.length < 6) {
      setError("Please enter the full 6-character code");
      return;
    }

    Keyboard.dismiss();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${getApiUrl()}/api/auth/cordon/exchange-code`, {
        method: "POST",
        headers: getApiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ code: code.toUpperCase() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Failed to verify code");
        setLoading(false);
        return;
      }

      if (data.jwt) {
        await SecureStore.setItemAsync(CORDON_JWT_KEY, data.jwt);
      }
      
      if (data.user) {
        await SecureStore.setItemAsync(CORDON_USER_KEY, JSON.stringify(data.user));
      }

      setSuccess(true);
      
      setTimeout(() => {
        onSuccess(data.user, data.jwt);
      }, 1000);
    } catch (err: any) {
      setError(err.message || "Network error");
      setLoading(false);
    }
  };

  const formatCode = (text: string) => {
    return text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  };

  if (success) {
    return (
      <View style={[styles.container, { backgroundColor: theme.backgroundDefault }]}>
        <View style={[styles.successIcon, { backgroundColor: theme.success + "20" }]}>
          <Feather name="check" size={32} color={theme.success} />
        </View>
        <ThemedText type="h2" style={styles.title}>Verified!</ThemedText>
        <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>
          You are now logged in
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundDefault }]}>
      <View style={[styles.iconContainer, { backgroundColor: theme.accent + "20" }]}>
        <Feather name="key" size={28} color={theme.accent} />
      </View>
      
      <ThemedText type="h2" style={styles.title}>Enter Verification Code</ThemedText>
      <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center", marginBottom: Spacing.xl }}>
        Paste the 6-character code from your browser
      </ThemedText>

      <TextInput
        ref={inputRef}
        style={[
          styles.codeInput,
          { 
            backgroundColor: theme.backgroundRoot, 
            color: theme.text,
            borderColor: error ? theme.danger : theme.border,
          },
        ]}
        value={code}
        onChangeText={(text) => {
          setCode(formatCode(text));
          setError(null);
        }}
        placeholder="ABC123"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        keyboardType="default"
        autoFocus
      />

      {error ? (
        <View style={styles.errorContainer}>
          <Feather name="alert-circle" size={16} color={theme.danger} />
          <ThemedText type="caption" style={{ color: theme.danger, marginLeft: Spacing.xs }}>
            {error}
          </ThemedText>
        </View>
      ) : null}

      <View style={styles.buttons}>
        <Pressable
          style={[styles.button, styles.cancelButton, { borderColor: theme.border }]}
          onPress={onCancel}
          disabled={loading}
        >
          <ThemedText type="body" style={{ color: theme.textSecondary }}>Cancel</ThemedText>
        </Pressable>
        
        <Pressable
          style={[
            styles.button, 
            styles.verifyButton, 
            { backgroundColor: code.length === 6 ? theme.accent : theme.accent + "50" },
          ]}
          onPress={handleVerify}
          disabled={loading || code.length < 6}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <ThemedText type="body" style={{ color: "#fff", fontWeight: "600" }}>Verify</ThemedText>
          )}
        </Pressable>
      </View>

      <View style={[styles.helpContainer, { backgroundColor: theme.accent + "10" }]}>
        <Feather name="info" size={16} color={theme.accent} />
        <ThemedText type="caption" style={{ color: theme.accent, marginLeft: Spacing.sm, flex: 1 }}>
          The code was shown after you signed in with Google in your browser. It expires in 5 minutes.
        </ThemedText>
      </View>
    </View>
  );
}

export async function getStoredCordonAuth(): Promise<{ user: any; jwt: string } | null> {
  try {
    const jwt = await SecureStore.getItemAsync(CORDON_JWT_KEY);
    const userStr = await SecureStore.getItemAsync(CORDON_USER_KEY);
    
    if (jwt && userStr) {
      return { user: JSON.parse(userStr), jwt };
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearStoredCordonAuth(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(CORDON_JWT_KEY);
    await SecureStore.deleteItemAsync(CORDON_USER_KEY);
  } catch {
  }
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.lg,
    alignItems: "center",
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  codeInput: {
    width: "100%",
    height: 56,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    fontSize: 24,
    fontFamily: "monospace",
    letterSpacing: 8,
    textAlign: "center",
    fontWeight: "bold",
    marginBottom: Spacing.md,
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  buttons: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.md,
    width: "100%",
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButton: {
    borderWidth: 1,
  },
  verifyButton: {
  },
  helpContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.xl,
    width: "100%",
  },
});
