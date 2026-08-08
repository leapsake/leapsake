import { Text, View } from "react-native";
import { Link } from "expo-router";
import { colors, styles } from "../lib/styles";

/**
 * The catalogs that aren't tabs — the cross-cutting lists (every holiday and who
 * observes it; every gift idea and who it's earmarked for; every tag and what
 * wears it) that no per-person screen reconstructs. They sit on the root stack,
 * so opening one pushes full-screen over the tab bar.
 *
 * This is the single source for the list because it is rendered in **two**
 * places — the Menu tab and the Search screen's empty state — and two hand-kept
 * copies would drift the first time a third catalog appears.
 */
export const CATALOGS = [
  { href: "/holidays", glyph: "🎉", label: "Holidays" },
  { href: "/gifts", glyph: "🎁", label: "Gifts" },
  { href: "/tags", glyph: "🏷️", label: "Tags" },
] as const;

/**
 * The catalogs as a list of rows. Deliberately headingless — each caller frames
 * it for itself (the Menu tab's own title is enough; Search labels it "Browse").
 */
export function CatalogLinks() {
  return (
    <View>
      {CATALOGS.map((catalog) => (
        <Link key={catalog.href} href={catalog.href} style={styles.row}>
          <Text style={[styles.rowText, { color: colors.accent }]}>
            {catalog.glyph} {catalog.label}
          </Text>
        </Link>
      ))}
    </View>
  );
}
