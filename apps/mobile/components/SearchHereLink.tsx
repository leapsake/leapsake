import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import { categoryFor, facetParam, facetsOf } from "../lib/search-categories";
import { styles } from "../lib/styles";

const GLYPH = "🔍";

/**
 * A catalog's 🔍 into Search, narrowed to the record kinds it holds; an
 * unknown key narrows nothing. `navigate`, since the tab is already below.
 */
export function SearchHereLink({ category }: { category: string }) {
  const router = useRouter();
  const found = categoryFor(category);
  const type = found === undefined ? undefined : facetParam(facetsOf(found));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search"
      testID={`search-here-${category}`}
      hitSlop={8}
      onPress={() =>
        router.navigate({
          pathname: "/(tabs)/search",
          params: { type },
        })
      }
    >
      <Text style={styles.headerGlyph}>{GLYPH}</Text>
    </Pressable>
  );
}
