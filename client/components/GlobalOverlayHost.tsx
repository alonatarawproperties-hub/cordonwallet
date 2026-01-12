import { StyleSheet, View } from "react-native";
import { RiskAuraOverlay } from "./RiskAuraOverlay";
import { SecurityOverlayCard } from "./SecurityOverlayCard";

export function GlobalOverlayHost() {
  return (
    <View style={styles.overlayContainer} pointerEvents="box-none">
      <RiskAuraOverlay />
      <SecurityOverlayCard />
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99999,
    elevation: 99999,
  },
});
