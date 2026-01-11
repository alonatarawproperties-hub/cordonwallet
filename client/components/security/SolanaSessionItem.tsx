import { View, StyleSheet, Pressable, Image } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { SolanaSession } from "@/hooks/useSolanaPermissions";

interface SolanaSessionItemProps {
  session: SolanaSession;
  onDisconnect: (topic: string) => void;
  isDisconnecting?: boolean;
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return url;
  }
}

export function SolanaSessionItem({
  session,
  onDisconnect,
  isDisconnecting = false,
}: SolanaSessionItemProps) {
  const { theme } = useTheme();
  const domain = extractDomain(session.peerMeta.url);
  const iconUrl = session.peerMeta.icons?.[0];

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundSecondary }]}>
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          {iconUrl ? (
            <Image source={{ uri: iconUrl }} style={styles.icon} />
          ) : (
            <View style={[styles.iconPlaceholder, { backgroundColor: theme.backgroundRoot }]}>
              <Feather name="globe" size={20} color={theme.textSecondary} />
            </View>
          )}
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <ThemedText type="body" style={{ fontWeight: "600" }} numberOfLines={1}>
              {session.peerMeta.name}
            </ThemedText>
            {session.isVerified ? (
              <View style={styles.verifiedBadge}>
                <Feather name="check-circle" size={12} color="#22C55E" />
                <ThemedText type="caption" style={{ color: "#22C55E", fontSize: 10 }}>
                  Verified
                </ThemedText>
              </View>
            ) : (
              <View style={[styles.verifiedBadge, { backgroundColor: "#F59E0B20" }]}>
                <Feather name="alert-circle" size={12} color="#F59E0B" />
                <ThemedText type="caption" style={{ color: "#F59E0B", fontSize: 10 }}>
                  Unverified
                </ThemedText>
              </View>
            )}
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
            {domain}
          </ThemedText>
        </View>
      </View>

      <View style={styles.permissions}>
        <View style={styles.permissionItem}>
          <Feather name="eye" size={12} color={theme.textSecondary} />
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            View address
          </ThemedText>
        </View>
        <View style={styles.permissionItem}>
          <Feather name="edit-3" size={12} color={theme.textSecondary} />
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Request signatures
          </ThemedText>
        </View>
      </View>

      <Pressable
        style={[styles.disconnectButton, { borderColor: "#EF4444" }]}
        onPress={() => onDisconnect(session.topic)}
        disabled={isDisconnecting}
      >
        <Feather name="log-out" size={14} color="#EF4444" />
        <ThemedText type="caption" style={{ color: "#EF4444", fontWeight: "600" }}>
          {isDisconnecting ? "Disconnecting..." : "Disconnect"}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  iconContainer: {
    width: 40,
    height: 40,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
  },
  iconPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.md,
    justifyContent: "center",
    alignItems: "center",
  },
  info: {
    flex: 1,
    gap: Spacing.xs,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    backgroundColor: "#22C55E20",
  },
  permissions: {
    flexDirection: "row",
    gap: Spacing.lg,
    marginBottom: Spacing.md,
  },
  permissionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  disconnectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
});
