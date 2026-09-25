import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import { styles } from "../lib/styles";

const GLYPH = "➕";

/**
 * A screen's **create** action: a bare ➕ in the header corner that opens the
 * create screen named in `lib/tab-screens.ts`.
 */
export function NewLink({
  href,
  label,
  testID,
}: {
  href: string;
  /** The accessible name, saying what gets made; the glyph alone does not. */
  label: string;
  testID: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={8}
      onPress={() => router.push(href)}
    >
      <Text style={styles.headerGlyph}>{GLYPH}</Text>
    </Pressable>
  );
}
