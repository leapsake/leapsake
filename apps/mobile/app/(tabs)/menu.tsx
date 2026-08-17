import { Text, View } from "react-native";
import { Link } from "expo-router";
import { CatalogLinks } from "../../components/CatalogLinks";
import { colors, styles } from "../../lib/styles";

/**
 * The Menu tab — everything that isn't one of the three standing destinations
 * (Home, People & Pets, Search). That's the three catalogs plus Notifications,
 * Data, and Settings, none of which is reachable from any entity.
 *
 * Deliberately *only* the overflow: People isn't listed even though a "menu"
 * might suggest a full sitemap. It's already a permanent tab, and the row would
 * switch tabs while every neighbouring row pushes a screen — one row obeying
 * different physics than the rest of the list it sits in.
 *
 * Static, so no {@link useFocusedData}: nothing here reads the database.
 */
export default function MenuScreen() {
  return (
    <View style={styles.screen}>
      {/* One gapless wrapper so Notifications, Data, and Settings continue the
          same hairline-separated list rather than floating a `screen` gap
          below it. */}
      <View>
        <CatalogLinks />
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
            ⚙️ Settings
          </Text>
        </Link>
      </View>
    </View>
  );
}
