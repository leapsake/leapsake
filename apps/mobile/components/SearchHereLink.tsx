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
 * kind of thing they were already looking at. It is also the reason
 * `?type=` exists as a URL parameter rather than as state inside the search
 * screen — arriving narrowed and tapping a tile have to mean the same thing.
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
