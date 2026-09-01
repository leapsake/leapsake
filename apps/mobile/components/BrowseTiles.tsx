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
 * A tap **opens the catalog** the tile names. These tiles once narrowed the
 * search instead, on the theory that the grid could double as the filter picker;
 * in use that made "People & Pets" a two-tap trip through a screen nobody asked
 * for, because a user who taps a tile on an empty search field is browsing, not
 * searching — they have said which catalog and *not* said what to look for. The
 * filter is still reachable, from the other end: each catalog carries a Search
 * link that arrives here already narrowed (`components/SearchHereLink.tsx`),
 * which is where a user has actually asked to search within a kind of thing.
 *
 * People keeps a tile even though it also has a tab of its own. The grid answers
 * "what kinds of thing are in here?", and dropping the biggest one to avoid
 * repeating a button would make the answer wrong to save a duplicate that costs
 * nothing.
 *
 * The category table lives in `lib/search-categories.ts`, shared with the filter.
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
