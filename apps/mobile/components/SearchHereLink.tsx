import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import { styles } from "../lib/styles";

const LABEL = "Search";

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
      testID={`search-here-${category}`}
      onPress={() =>
        router.navigate({
          pathname: "/(tabs)/search",
          params: { type: category },
        })
      }
    >
      <Text style={styles.link}>{LABEL}</Text>
    </Pressable>
  );
}
