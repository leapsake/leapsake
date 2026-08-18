import { type ColorValue, Text, View } from "react-native";
import { Link, Tabs } from "expo-router";
import { AppHeader } from "../../components/AppHeader";
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
        tabBarInactiveTintColor: colors.muted,
        // The two pieces of chrome that frame every tab. Both sit a shade deeper
        // than the page, and neither draws the platform's default hairline —
        // the tone change is the edge.
        tabBarStyle: {
          backgroundColor: colors.surfaceRaised,
          borderTopWidth: 0,
        },
        sceneStyle: { backgroundColor: colors.surface },
        // The same header the root stack draws (app/_layout.tsx), so a tab root
        // and a screen pushed over it are the same chrome. It takes no `onBack`
        // here and there is nothing to pass one from: a tab root has no back
        // destination, so the four of them cannot show a back control.
        //
        // This also retires `headerRightContainerStyle`, which existed only to
        // undo the bottom-tab navigator's missing edge inset — AppHeader insets
        // both edges itself.
        header: ({ options, route }) => (
          <AppHeader
            title={options.title ?? route.name}
            right={options.headerRight?.({
              canGoBack: false,
              tintColor: colors.accent,
            })}
          />
        ),
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
