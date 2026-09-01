import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import { styles } from "../lib/styles";

const GLYPH = "➕";

/**
 * A screen's **create** action, in the top-right corner, making the one thing
 * that screen is about.
 *
 * New used to be a tab — a verb sharing the bottom bar with three places, going
 * wherever the screen behind it implied. That cost People its seat in the bar,
 * which was the wrong trade: People & Pets is the app's biggest catalog and the
 * thing it is mostly *about*, and reaching it through Search's browse tiles made
 * the most-visited list in the app a two-tap trip. So the bar went back to being
 * four destinations, and creating came back up here, where it names its own
 * target instead of resolving one.
 *
 * The screens that carry it, declared with their titles in
 * `app/(tabs)/_layout.tsx`:
 *
 * - **Home** → a reminder. Home is the reminders list; a chooser asking "person,
 *   reminder, or gift idea?" on the app's landing screen was a tap charged for a
 *   question the screen had already answered.
 * - **People & Pets** → `/add`, which covers both behind its own toggle.
 * - **Gifts** → a gift idea.
 *
 * **Holidays and Tags carry nothing**, and that absence is the design rather
 * than an omission: a holiday comes from a seeded catalog and a tag exists only
 * because something wears it, so there is no create screen for either. A ➕ there
 * would have to make something *unrelated to the screen it sits on*, which is the
 * exact ambiguity the old chooser existed to resolve — and resolving it was the
 * chooser's whole cost. Better that a screen with nothing to create says so by
 * having no button.
 *
 * A glyph rather than "➕ New": it shares the corner with {@link SearchHereLink}
 * on two of the three, and the accessible name carries what it makes.
 */
export function NewLink({
  href,
  what,
  testID,
}: {
  /** The create screen this leads to. */
  href: string;
  /**
   * What gets made, for the accessible name — "person or pet", "reminder". The
   * glyph says *that* you can add; only this says *what*, and on a screen whose
   * title is off to the left it is the only thing that does.
   */
  what: string;
  testID: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`New ${what}`}
      testID={testID}
      hitSlop={8}
      onPress={() => router.push(href)}
    >
      <Text style={styles.headerGlyph}>{GLYPH}</Text>
    </Pressable>
  );
}
