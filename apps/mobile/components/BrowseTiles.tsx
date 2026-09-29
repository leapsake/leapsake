import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  SEARCH_CATEGORIES,
  type SearchCategory,
} from "../lib/search-categories";
import { colors, radius } from "../lib/styles";

/**
 * Search before anything is typed: a tile per catalog, People included, and a
 * tap opens the catalog rather than narrowing the search.
 */
export function BrowseTiles({
  onPick,
}: {
  onPick: (category: SearchCategory) => void;
}) {
  return (
    <View style={local.grid}>
      {SEARCH_CATEGORIES.map((category) => (
        <Pressable
          key={category.key}
          accessibilityRole="button"
          testID={`browse-tile-${category.key}`}
          style={local.tile}
          onPress={() => onPick(category)}
        >
          <Text style={local.glyph}>{category.glyph}</Text>
          <Text style={local.label}>{category.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const local = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  tile: {
    // Two to a row on a phone, leaving room for the gap; more on a wider one.
    flexBasis: "47%",
    flexGrow: 1,
    gap: 4,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  glyph: {
    fontSize: 26,
  },
  label: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text,
  },
});
