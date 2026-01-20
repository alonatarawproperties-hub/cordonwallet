import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { getChainLogoUrl } from "../lib/token-logos";

type Props = {
  chainId?: number | string | null;
  size?: number;
};

export function ChainBadge({ chainId, size = 14 }: Props) {
  if (chainId === undefined || chainId === null) return null;
  const url = getChainLogoUrl(chainId);
  if (!url) return null;

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
});
