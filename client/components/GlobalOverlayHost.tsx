import { StyleSheet, View, Dimensions } from "react-native";
import { RiskAuraOverlay } from "./RiskAuraOverlay";
import { SecurityOverlayCard } from "./SecurityOverlayCard";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("screen");

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
    position: "absolute",
    top: 0,
    left: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    zIndex: 99999,
    elevation: 99999,
  },
});
