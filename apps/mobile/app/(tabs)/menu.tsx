import { Text, View } from "react-native";
import { Link } from "expo-router";
import Constants from "expo-constants";
import { versionLabel } from "../../lib/app-version";
import { colors, styles } from "../../lib/styles";

/** The Settings tab's rows, the same whether or not an account exists. */
const ROWS = [
  { href: "/settings", glyph: "👤", label: "Account" },
  { href: "/data", glyph: "💾", label: "Data" },
  { href: "/notifications", glyph: "🔔", label: "Notifications" },
  // Last: about the app, and a licence obligation as well as a screen.
  { href: "/acknowledgements", glyph: "💚", label: "Acknowledgements" },
] as const;

const VERSION = versionLabel(
  Constants.expoConfig?.extra?.release,
  Constants.expoConfig?.version ?? "0.0.0",
);

export default function MenuScreen() {
  return (
    <View style={styles.screen}>
      {/* Gapless, so the rows read as one hairline-separated list. */}
      <View>
        {ROWS.map((row) => (
          <Link key={row.label} href={row.href} style={styles.row}>
            <Text style={[styles.rowText, { color: colors.accent }]}>
              {row.glyph} {row.label}
            </Text>
          </Link>
        ))}
      </View>
      <Text
        testID="app-version"
        selectable
        style={[styles.muted, { marginTop: "auto", textAlign: "center" }]}
      >
        {VERSION}
      </Text>
    </View>
  );
}
