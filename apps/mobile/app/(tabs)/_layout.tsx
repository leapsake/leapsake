import { type ColorValue, Text, View } from "react-native";
import { Link, Tabs } from "expo-router";
import { colors, styles } from "../../lib/styles";

/**
 * The app's bottom tab bar: the People & Pets home and global Search. Detail
 * screens (people/[id], pets/[id], relationships, tags) live outside this group
 * on the root stack, so navigating into one pushes full-screen over the tabs —
 * the standard pattern. This navigator owns each tab's header (the root stack
 * hides its own header for the `(tabs)` route in app/_layout.tsx).
 *
 * Tab icons are plain emoji `<Text>` rather than a vector-icon font, keeping the
 * dependency budget (no `@expo/vector-icons`); the `color` follows focus.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 22, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.accent }}>
      <Tabs.Screen
        name="index"
        options={{
          title: "People & Pets",
          tabBarLabel: "Home",
          tabBarIcon: ({ color }) => <TabIcon glyph="👥" color={color} />,
          headerRight: () => (
            <View style={styles.headerActions}>
              <Link href="/people/new" style={styles.link}>
                Add person
              </Link>
              <Link href="/pets/new" style={styles.link}>
                Add pet
              </Link>
              <Link href="/settings" style={styles.link}>
                Settings
              </Link>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => <TabIcon glyph="🔍" color={color} />,
        }}
      />
    </Tabs>
  );
}
