import { Text, View } from "react-native";
import { Link } from "expo-router";
import { colors, styles } from "../lib/styles";

/**
 * The catalogs that aren't tabs — the cross-cutting lists (every holiday and who
 * observes it; every gift idea and who it's earmarked for; every tag and what
 * wears it) that no per-person screen reconstructs. They sit on the root stack,
 * so opening one pushes full-screen over the tab bar.
 *
 * This is the single source for the list because Search's empty state is where
 * it's rendered, and keeping it its own module (rather than inline in that
 * screen) is what let it also live on the Menu tab until that row moved here.
 */
export const CATALOGS = [
  { href: "/holidays", glyph: "🎉", label: "Holidays" },
  { href: "/gifts", glyph: "🎁", label: "Gifts" },
  { href: "/tags", glyph: "🏷️", label: "Tags" },
] as const;

/**
 * The catalogs as a list of rows. Deliberately headingless — the caller frames
 * it for itself (Search labels it "Browse").
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
