import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import { styles } from "../lib/styles";

const GLYPH = "🔍";

/**
 * A catalog's way into Search, already narrowed to what the catalog holds.
 *
 * This is what keeps the catalogs usable now that the search field lives on its
 * own tab: a user scrolling People & Pets who realises they want to *find*
 * someone rather than scroll shouldn't have to go to Search and re-state which
 * kind of thing they were already looking at.
 *
 * This is now the *only* way the search screen arrives narrowed — its browse
 * tiles open the catalogs rather than filtering — which is the right shape:
 * narrowing is a thing you ask for from inside a catalog, having decided that
 * scrolling it is not working.
 *
 * ### A glyph, because it shares the corner
 *
 * It read "Search" for as long as it was alone up there. It isn't: People and
 * Gifts carry {@link NewLink} beside it, and two words at the trailing edge of a
 * phone header leave a name like "People & Pets" nothing to sit in. The glyph is
 * the same one the search field itself wears (`components/SearchInput.tsx`), so
 * this is the app repeating its own symbol rather than inventing one — and the
 * accessible name still says the word outright, which is what a screen reader
 * and the E2E flows both read.
 *
 * **`navigate`, not `push`.** The search tab is not somewhere to stack on top of
 * a catalog; it is somewhere the app already is, underneath it. `navigate`
 * returns to the tabs already in history and selects Search, so Back from there
 * leaves the way it always does instead of unwinding a catalog the user has
 * visually left.
 */
export function SearchHereLink({ category }: { category: string }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      // The word the glyph stands for, and the whole of this control's name for
      // anyone not reading the picture.
      accessibilityLabel="Search"
      testID={`search-here-${category}`}
      hitSlop={8}
      onPress={() =>
        router.navigate({
          pathname: "/(tabs)/search",
          params: { type: category },
        })
      }
    >
      <Text style={styles.headerGlyph}>{GLYPH}</Text>
    </Pressable>
  );
}
