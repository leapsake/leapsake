import { Text } from "react-native";
import { Link } from "expo-router";
import { styles } from "../lib/styles";

/**
 * The **Edit** a record's detail screen carries, top-left beside Back — the one
 * way into the form that revises it.
 *
 * There used to be an Edit per field and an Add per section, each writing where
 * it stood. That answered "how do I change this?" everywhere on the page at the
 * cost of never answering "how do I change *this record*?", and it left no way to
 * abandon a change once started, since each little editor wrote on its own Save.
 * One button, one form, one Save — and Back means cancel again.
 *
 * Leading rather than trailing because of what sits opposite it: the form it
 * opens carries {@link HeaderSave} on the right, and an Edit that turns into a
 * Save in the same corner reads as the same control changing its mind.
 *
 * Rendered from a screen's `Stack.Screen options.headerLeft`, which
 * `app/_layout.tsx` draws *after* Back rather than in place of it.
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
