import { useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "SeedPhrase">;

export default function SeedPhraseScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { theme } = useTheme();
  const { seedPhrase } = route.params;
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(seedPhrase.join(" "));
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleContinue = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: "Main" }],
    });
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing["2xl"] }]}>
      <ScrollView 
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.dangerCard, { backgroundColor: theme.danger + "15", borderColor: theme.danger + "40" }]}>
          <Feather name="alert-triangle" size={20} color={theme.danger} />
          <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>
            Never share this phrase. Anyone with it has full access to your wallet.
          </ThemedText>
        </View>

        <ThemedText type="h3" style={styles.title}>
          Your Seed Phrase
        </ThemedText>
        <ThemedText type="body" style={[styles.subtitle, { color: theme.textSecondary }]}>
          Write these 12 words in order and store them safely.
        </ThemedText>

        {!revealed ? (
          <Pressable 
            style={[styles.revealCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}
            onPress={() => setRevealed(true)}
          >
            <Feather name="eye" size={32} color={theme.textSecondary} />
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              Tap to reveal seed phrase
            </ThemedText>
          </Pressable>
        ) : (
          <View style={[styles.phraseContainer, { backgroundColor: theme.backgroundDefault }]}>
            <View style={styles.phraseGrid}>
              {seedPhrase.map((word, index) => (
                <View key={index} style={[styles.wordCard, { backgroundColor: theme.backgroundSecondary }]}>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {index + 1}
                  </ThemedText>
                  <ThemedText type="body" style={styles.word}>
                    {word}
                  </ThemedText>
                </View>
              ))}
            </View>

            <Pressable 
              style={[styles.copyButton, { backgroundColor: theme.backgroundSecondary }]}
              onPress={handleCopy}
            >
              <Feather name={copied ? "check" : "copy"} size={18} color={theme.accent} />
              <ThemedText type="small" style={{ color: theme.accent }}>
                {copied ? "Copied!" : "Copy to clipboard"}
              </ThemedText>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button onPress={handleContinue} disabled={!revealed}>
          I've Backed It Up
        </Button>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing["2xl"],
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: Spacing["2xl"],
  },
  dangerCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.md,
    marginBottom: Spacing["2xl"],
  },
  title: {
    marginBottom: Spacing.sm,
  },
  subtitle: {
    marginBottom: Spacing["2xl"],
  },
  revealCard: {
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing["4xl"],
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    gap: Spacing.md,
  },
  phraseContainer: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
  },
  phraseGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  wordCard: {
    width: "30%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
  },
  word: {
    fontWeight: "600",
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
  },
  footer: {
    marginTop: Spacing.lg,
  },
});
