import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../lib/styles";

const THUMBNAIL_SIZE = 56;

/** A gift's picture, fetched from its shop; nothing at all if it won't load. */
export function GiftImage({ uri }: { uri: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      source={{ uri }}
      style={local.hero}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      onError={() => setFailed(true)}
    />
  );
}

/** A gift's picture as a list-row lead, or 🎁 without one, so rows align. */
export function GiftThumbnail({ uri }: { uri: string | null }) {
  const [failed, setFailed] = useState(false);
  if (uri === null || failed) {
    return (
      <View
        style={[local.thumbnail, local.placeholder]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={local.glyph}>🎁</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={local.thumbnail}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      onError={() => setFailed(true)}
    />
  );
}

const local = StyleSheet.create({
  hero: {
    width: "100%",
    aspectRatio: 1.6,
    borderRadius: radius.sm,
    backgroundColor: "#ffffff",
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: "#ffffff",
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  glyph: { fontSize: 24 },
});
