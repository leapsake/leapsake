import { Text, View } from "react-native";
import { Link } from "expo-router";
import { colors, styles } from "../../lib/styles";

/**
 * The Settings / Account tab — everything that isn't Home or Search, none of
 * which is reachable from any entity: Notifications, Data, and the account
 * screen itself.
 *
 * **The tab's name follows custody** (`lib/use-has-account.ts`, read by
 * `(tabs)/_layout.tsx`) but its rows no longer do. They used to: signed out, the
 * account row was worded as an offer ("✨ Create an account") and sat *last*,
 * among the switches. One row that renamed and moved itself out from under the
 * user was a worse trade than the invitation was worth (owner, 2026-08-21), so
 * the row is now "Account" in both states and always leads.
 *
 * Both states push to the same `app/settings.tsx`, which already branches on
 * custody far more finely than a menu row could; splitting it in two here would
 * mean two doors onto one screen that then has to work out which one you came
 * through.
 *
 * Deliberately *only* the overflow: People & Pets isn't listed even though a
 * settings screen might suggest a full sitemap. It belongs to Search's browse
 * tiles, which is one place rather than two that can disagree.
 *
 * The catalogs (Holidays, Gifts, Tags) used to live here too and moved to those
 * same tiles.
 */

/** The rows, in the order they're offered — the same list whether or not an
 *  account exists. */
const ROWS = [
  { href: "/settings", glyph: "👤", label: "Account" },
  { href: "/data", glyph: "💾", label: "Data" },
  { href: "/notifications", glyph: "🔔", label: "Notifications" },
  // Last, and about the app rather than about you — the only row here that is a
  // licence obligation as well as a screen (see app/acknowledgements.tsx).
  { href: "/acknowledgements", glyph: "💚", label: "Acknowledgements" },
] as const;

export default function MenuScreen() {
  return (
    <View style={styles.screen}>
      {/* One gapless wrapper so the rows continue a single hairline-separated
          list rather than floating a `screen` gap between them. */}
      <View>
        {ROWS.map((row) => (
          <Link key={row.label} href={row.href} style={styles.row}>
            <Text style={[styles.rowText, { color: colors.accent }]}>
              {row.glyph} {row.label}
            </Text>
          </Link>
        ))}
      </View>
    </View>
  );
}
