import { Text } from "react-native";
import { Link } from "expo-router";
import { styles } from "../lib/styles";

/**
 * The **Edit** a record's detail screen carries, top-right — the one way into
 * the form that revises it.
 *
 * There used to be an Edit per field and an Add per section, each writing where
 * it stood. That answered "how do I change this?" everywhere on the page at the
 * cost of never answering "how do I change *this record*?", and it left no way to
 * abandon a change once started, since each little editor wrote on its own Save.
 * One button, one form, one Save — and Back means cancel again.
 *
 * Trailing, so the corner opposite Back holds this screen's action the way it
 * does everywhere else in the app: the {@link HeaderSave} on the form this
 * opens, Search-here on the catalogs. Edit and the Save it becomes land in the
 * same corner, which reads as one control changing its mind.
 *
 * Rendered from a screen's `Stack.Screen options.headerRight`.
 */
export function HeaderEdit({ href, what }: { href: string; what: string }) {
  return (
    <Link
      href={href}
      accessibilityRole="button"
      // Spelled out for a screen reader, which would otherwise hear a bare
      // "Edit" with nothing to say what it edits.
      accessibilityLabel={`Edit ${what}`}
      style={styles.link}
    >
      <Text style={styles.link}>Edit</Text>
    </Link>
  );
}
