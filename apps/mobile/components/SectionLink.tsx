import { StyleSheet } from "react-native";
import { Link } from "expo-router";
import { styles } from "../lib/styles";

const GLYPH = { add: "➕", edit: "⋯" } as const;
const LABEL = {
  add: (what: string) => `Add ${what}`,
  edit: (what: string) => `Edit ${what}`,
} as const;

/**
 * A section header's action as a bare glyph: ➕ to add, ⋯ to edit. `what`
 * names it for a screen reader, which reads the whole phrase, e.g. "Add gift".
 */
export function SectionLink({
  href,
  what,
  action = "edit",
}: {
  href: string;
  what: string;
  action?: "add" | "edit";
}) {
  return (
    <Link
      href={href}
      accessibilityRole="button"
      accessibilityLabel={LABEL[action](what)}
      style={action === "add" ? local.add : [styles.link, local.edit]}
    >
      {GLYPH[action]}
    </Link>
  );
}

// Centred in the same width as a row's ⋯, so the column lines up.
const local = StyleSheet.create({
  add: {
    fontSize: 17,
    minWidth: 32,
    paddingVertical: 4,
    textAlign: "center",
  },
  edit: {
    minWidth: 32,
    paddingVertical: 4,
    textAlign: "center",
  },
});
