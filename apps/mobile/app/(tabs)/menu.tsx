import { Text, View } from "react-native";
import { Link } from "expo-router";
import { colors, styles } from "../../lib/styles";

/**
 * The Settings tab — everything that isn't one of the three standing
 * destinations (Home, People & Pets, Search): Notifications, Data, and the
 * Account screen, none of which is reachable from any entity. The catalogs
 * (Holidays, Gifts, Tags) used to live here too; they moved to Search's browse
 * list, which already listed them, so this tab is the overflow proper rather
 * than a second copy of it.
 *
 * Deliberately *only* the overflow: People isn't listed even though a settings
 * screen might suggest a full sitemap. It's already a permanent tab, and the
 * row would switch tabs while every neighbouring row pushes a screen — one row
 * obeying different physics than the rest of the list it sits in.
 *
 * Static, so no {@link useFocusedData}: nothing here reads the database.
 */
export default function MenuScreen() {
  return (
    <View style={styles.screen}>
      {/* One gapless wrapper so Notifications, Data, and Account continue the
          same hairline-separated list rather than floating a `screen` gap
          below it. */}
      <View>
        <Link href="/notifications" style={styles.row}>
          <Text style={[styles.rowText, { color: colors.accent }]}>
            🔔 Notifications
          </Text>
        </Link>
        <Link href="/data" style={styles.row}>
          <Text style={[styles.rowText, { color: colors.accent }]}>
            💾 Data
          </Text>
        </Link>
        <Link href="/settings" style={styles.row}>
          <Text style={[styles.rowText, { color: colors.accent }]}>
            👤 Account
          </Text>
        </Link>
      </View>
    </View>
  );
}
