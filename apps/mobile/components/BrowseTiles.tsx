import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  SEARCH_CATEGORIES,
  type SearchCategory,
} from "../lib/search-categories";
import { colors, radius } from "../lib/styles";

/**
 * What Search shows before anything is typed: a tile per kind of record, so an
 * empty search field is a place to *browse* rather than a blank box that offers
 * nothing until you already know what you want.
 *
 * This replaced a list of plain text links, which was accurate and unhelpful —
 * it read as a footnote under the field rather than as the answer to "what is in
 * this app?". Tiles are also honest about the shape of the thing: four kinds of
 * record, all equal, none of them a sub-item of the field above them.
 *
 * A tap **narrows the search** rather than leaving for the list behind it. That
 * is what makes the filter discoverable: there is no separate control to find,
 * because the browse grid and the filter picker are the same four tiles. The way
 * on to the full list is offered once the category is chosen, where it answers a
 * question the user has by then actually asked.
 *
 * The category table lives in `lib/search-categories.ts`, shared with the filter
 * itself and with what New means on a filtered search.
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
    // Two to a row at every phone width: a little under half the space, so the
    // gap between them fits. `flexBasis` rather than a fixed width, so a wider
    // screen fits more per row instead of stretching two.
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
