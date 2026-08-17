import { type ColorValue, Text, View } from "react-native";
import { Link, Tabs } from "expo-router";
import { colors, styles } from "../../lib/styles";

/**
 * The app's bottom tab bar, kept to **four** standing destinations: Reminders
 * (the home/landing tab, so it lives at the group's `index` route), the combined
 * People & Pets list, global Search, and Settings.
 *
 * Everything else lives outside this group on the root stack, so navigating into
 * one pushes full-screen over the tabs — the standard pattern. That covers the
 * detail screens (people/[id], pets/[id], relationships, tags, holidays/[id],
 * gifts/[id]) and the "+ Add" chooser, and now also the two **catalogs**
 * (holidays, gifts) and Account, which the Settings tab lists. The catalogs are
 * reference lists rather than places you live: each stays reachable from Search
 * (as a hit, and from the browse list its empty field shows, which also lists
 * People & Pets for completeness), and — per person or pet — from the sections
 * on their page. A permanent tab each was more prominence than either earns.
 *
 * This navigator owns each tab's header (the root stack hides its own header for
 * the `(tabs)` route in app/_layout.tsx).
 *
 * Tab icons are plain emoji `<Text>` rather than a vector-icon font, keeping the
 * dependency budget (no `@expo/vector-icons`); the `color` follows focus.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 22, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        // Inset the header actions from the screen edge. The bottom-tab
        // navigator draws its header in JS and leaves a custom `headerRight`
        // flush against the edge, where the native stack header the rest of the
        // app pushes gives its own buttons the platform's 16pt margin — so
        // "+ Add" sat harder against the right edge than "‹ Back" does against
        // the left. Set for every tab, since it is the navigator's default that
        // is wrong rather than any one screen's.
        headerRightContainerStyle: { paddingRight: 16 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Leapsake",
          tabBarLabel: "Home",
          tabBarIcon: ({ color }) => <TabIcon glyph="🏠" color={color} />,
          headerRight: () => (
            <View style={styles.headerActions}>
              <Link href="/reminders/new" style={styles.link}>
                + Add
              </Link>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="people"
        options={{
          title: "People & Pets",
          tabBarLabel: "People",
          tabBarIcon: ({ color }) => <TabIcon glyph="👥" color={color} />,
          headerRight: () => (
            <View style={styles.headerActions}>
              <Link href="/add" style={styles.link}>
                + Add
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
      <Tabs.Screen
        name="menu"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <TabIcon glyph="⚙️" color={color} />,
        }}
      />
    </Tabs>
  );
}
