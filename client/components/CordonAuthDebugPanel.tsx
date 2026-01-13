import { View, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";

export type AuthStep = "IDLE" | "STARTED" | "CODE_ISSUED" | "CODE_EXCHANGED" | "LOGGED_IN" | "ERROR";

interface CordonAuthDebugPanelProps {
  isCordonBrowser: boolean;
  currentUrl: string;
  hasAuthCookie: boolean;
  hasJwt: boolean;
  authStep: AuthStep;
  userEmail?: string;
}

export function CordonAuthDebugPanel({
  isCordonBrowser,
  currentUrl,
  hasAuthCookie,
  hasJwt,
  authStep,
  userEmail,
}: CordonAuthDebugPanelProps) {
  const { theme } = useTheme();

  const getStepColor = (step: AuthStep) => {
    switch (step) {
      case "LOGGED_IN": return theme.success;
      case "ERROR": return theme.danger;
      case "IDLE": return theme.textSecondary;
      default: return theme.warning;
    }
  };

  let domain = "";
  try {
    domain = new URL(currentUrl).hostname;
  } catch {
    domain = "N/A";
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
      <ThemedText type="small" style={[styles.title, { color: theme.warning }]}>
        Auth Debug Panel
      </ThemedText>
      
      <View style={styles.row}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>isCordonBrowser</ThemedText>
        <View style={[styles.badge, { backgroundColor: isCordonBrowser ? theme.success + "20" : theme.textSecondary + "20" }]}>
          <ThemedText type="caption" style={{ color: isCordonBrowser ? theme.success : theme.textSecondary }}>
            {isCordonBrowser ? "true" : "false"}
          </ThemedText>
        </View>
      </View>
      
      <View style={styles.row}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>Domain</ThemedText>
        <ThemedText type="caption" style={{ fontFamily: "monospace", color: theme.text }}>{domain}</ThemedText>
      </View>
      
      <View style={styles.row}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>Full URL</ThemedText>
        <ThemedText type="caption" style={{ fontFamily: "monospace", color: theme.textSecondary, flex: 1, textAlign: "right" }} numberOfLines={1}>
          {currentUrl.slice(0, 40)}...
        </ThemedText>
      </View>
      
      <View style={styles.row}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>Auth Cookie</ThemedText>
        <View style={[styles.badge, { backgroundColor: hasAuthCookie ? theme.success + "20" : theme.danger + "20" }]}>
          <ThemedText type="caption" style={{ color: hasAuthCookie ? theme.success : theme.danger }}>
            {hasAuthCookie ? "present" : "none"}
          </ThemedText>
        </View>
      </View>
      
      <View style={styles.row}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>JWT Token</ThemedText>
        <View style={[styles.badge, { backgroundColor: hasJwt ? theme.success + "20" : theme.textSecondary + "20" }]}>
          <ThemedText type="caption" style={{ color: hasJwt ? theme.success : theme.textSecondary }}>
            {hasJwt ? "stored" : "none"}
          </ThemedText>
        </View>
      </View>
      
      <View style={styles.row}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>Auth Step</ThemedText>
        <View style={[styles.badge, { backgroundColor: getStepColor(authStep) + "20" }]}>
          <ThemedText type="caption" style={{ color: getStepColor(authStep), fontWeight: "600" }}>
            {authStep}
          </ThemedText>
        </View>
      </View>
      
      {userEmail ? (
        <View style={styles.row}>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>User</ThemedText>
          <ThemedText type="caption" style={{ color: theme.success }}>{userEmail}</ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  title: {
    fontWeight: "600",
    marginBottom: Spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
