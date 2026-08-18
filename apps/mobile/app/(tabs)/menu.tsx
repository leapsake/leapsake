import { Text, View } from "react-native";
import { Link } from "expo-router";
import { useHasAccount } from "../../lib/use-has-account";
import { colors, styles } from "../../lib/styles";

/**
 * The Settings / Account tab — everything that isn't Home or Search, none of
 * which is reachable from any entity: Notifications, Data, and the account
 * screen itself.
 *
 * **The tab's name and its first row both follow custody**
 * (`lib/use-has-account.ts`). Signed out this is Settings, and the account is
 * the *last* row, worded as an offer: an account is invited, never required
 * (`AGENTS.md` → Product posture), so it sits among the switches rather than
 * above them. Signed in it is Account, and the account leads — it is what a user
 * with one comes to this tab for, and the switches are the things they'll want
 * second.
 *
 * That reordering is the whole content switch. Both states push to the same
 * `app/settings.tsx`, which already branches on custody far more finely than a
 * menu row could; splitting it in two here would mean two doors onto one screen
 * that then has to work out which one you came through.
 *
 * Deliberately *only* the overflow: People & Pets isn't listed even though a
 * settings screen might suggest a full sitemap. It belongs to Search's browse
 * tiles, which is one place rather than two that can disagree.
 *
 * The catalogs (Holidays, Gifts, Tags) used to live here too and moved to those
 * same tiles.
 */

/** The switches, in the order they're offered. Custody decides where the
 *  account row goes relative to them, not what they are. */
const SETTINGS_ROWS = [
  { href: "/notifications", glyph: "🔔", label: "Notifications" },
  { href: "/data", glyph: "💾", label: "Data" },
] as const;

const ACCOUNT_ROW = {
  href: "/settings",
  glyph: "👤",
  label: "Account",
} as const;
const ACCOUNT_OFFER = {
  href: "/settings",
  glyph: "✨",
  label: "Create an account",
} as const;

export default function MenuScreen() {
  const hasAccount = useHasAccount();
  const rows =
    hasAccount === true
      ? [ACCOUNT_ROW, ...SETTINGS_ROWS]
      : [...SETTINGS_ROWS, ACCOUNT_OFFER];

  return (
    <View style={styles.screen}>
      {/* One gapless wrapper so the rows continue a single hairline-separated
          list rather than floating a `screen` gap between them. */}
      <View>
        {rows.map((row) => (
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
