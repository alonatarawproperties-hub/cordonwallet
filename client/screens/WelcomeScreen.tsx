import { View, StyleSheet, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Welcome">;

export default function WelcomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top + Spacing["3xl"], paddingBottom: insets.bottom + Spacing["2xl"] }]}>
      <View style={styles.content}>
        <Image
          source={require("../../assets/images/icon.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <ThemedText type="h1" style={styles.title}>
          Cordon
        </ThemedText>
        <ThemedText type="body" style={[styles.subtitle, { color: theme.textSecondary }]}>
          Your secure gateway to Web3. Non-custodial, with built-in protection.
        </ThemedText>
      </View>

      <View style={styles.features}>
        <View style={[styles.featureCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[styles.featureIcon, { backgroundColor: theme.accent + "20" }]}>
            <Feather name="shield" size={24} color={theme.accent} />
          </View>
          <View style={styles.featureText}>
            <ThemedText type="h4">Wallet Firewall</ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Blocks risky transactions automatically
            </ThemedText>
          </View>
        </View>

        <View style={[styles.featureCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[styles.featureIcon, { backgroundColor: theme.success + "20" }]}>
            <Feather name="layers" size={24} color={theme.success} />
          </View>
          <View style={styles.featureText}>
            <ThemedText type="h4">Multi-Wallet Bundles</ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Manage multiple wallets with ease
            </ThemedText>
          </View>
        </View>

        <View style={[styles.featureCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[styles.featureIcon, { backgroundColor: theme.warning + "20" }]}>
            <Feather name="cpu" size={24} color={theme.warning} />
          </View>
          <View style={styles.featureText}>
            <ThemedText type="h4">AI Explainer</ThemedText>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Plain-English transaction explanations
            </ThemedText>
          </View>
        </View>
      </View>

      <View style={styles.buttons}>
        <Button onPress={() => navigation.navigate("CreateWallet")} style={styles.button}>
          Create New Wallet
        </Button>
        <Button 
          onPress={() => navigation.navigate("ImportWallet")} 
          style={[styles.button, styles.secondaryButton, { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.border }]}
        >
          Import Existing Wallet
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
  content: {
    alignItems: "center",
    marginTop: Spacing["2xl"],
  },
  logo: {
    width: 120,
    height: 120,
    borderRadius: BorderRadius.xl,
    marginBottom: Spacing.lg,
  },
  title: {
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
    paddingHorizontal: Spacing.lg,
  },
  features: {
    flex: 1,
    justifyContent: "center",
    gap: Spacing.md,
  },
  featureCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.lg,
  },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    flex: 1,
    gap: Spacing.xs,
  },
  buttons: {
    gap: Spacing.md,
  },
  button: {
    width: "100%",
  },
  secondaryButton: {
    backgroundColor: "transparent",
  },
});
