import { type ColorValue, Text, View } from "react-native";
import { Tabs } from "expo-router";
import { AppHeader } from "../../components/AppHeader";
import { NewLink } from "../../components/NewLink";
import { SearchHereLink } from "../../components/SearchHereLink";
import { headerTitle } from "../../lib/record-title";
import { colors, styles } from "../../lib/styles";
import { TAB_SCREENS, type TabScreen } from "../../lib/tab-screens";

/**
 * The app's bottom tab bar, and the catalogs hosted in it without a button.
 * Every screen, its title and its header glyphs come from {@link TAB_SCREENS}.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 22, color }}>{glyph}</Text>;
}

/** A screen's 🔍 and ➕, as the one node the header's right slot takes. */
function HeaderGlyphs({ search, create }: TabScreen) {
  const searchLink = search !== undefined && (
    <SearchHereLink category={search} />
  );
  const newLink = create !== undefined && (
    <NewLink href={create.href} label={create.label} testID={create.testID} />
  );
  if (searchLink && newLink) {
    return (
      <View style={styles.headerActions}>
        {searchLink}
        {newLink}
      </View>
    );
  }
  return searchLink || newLink || null;
}

function screenOptions(screen: TabScreen) {
  const { title, headerShown, tab } = screen;
  return {
    ...(title !== undefined && { title }),
    ...(headerShown !== undefined && { headerShown }),
    ...(tab === undefined
      ? { href: null }
      : {
          tabBarLabel: tab.label,
          tabBarButtonTestID: tab.testID,
          tabBarIcon: ({ color }: { color: ColorValue }) => (
            <TabIcon glyph={tab.glyph} color={color} />
          ),
        }),
    ...((screen.search !== undefined || screen.create !== undefined) && {
      headerRight: () => <HeaderGlyphs {...screen} />,
    }),
  };
}

export default function TabsLayout() {
  return (
    <Tabs
      // Android's hardware back retraces the tabs and catalogs visited, not straight to Home.
      backBehavior="history"
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surfaceRaised,
          borderTopWidth: 0,
        },
        sceneStyle: { backgroundColor: colors.surface },
        // No `onBack`: nothing in this navigator shows a back control.
        header: ({ options, route }) => (
          <AppHeader
            title={headerTitle(options, route)}
            showLogo={route.name === "index"}
            right={options.headerRight?.({
              canGoBack: false,
              tintColor: colors.accent,
            })}
          />
        ),
      }}
    >
      {TAB_SCREENS.map((screen) => (
        <Tabs.Screen
          key={screen.name}
          name={screen.name}
          options={screenOptions(screen)}
        />
      ))}
    </Tabs>
  );
}
