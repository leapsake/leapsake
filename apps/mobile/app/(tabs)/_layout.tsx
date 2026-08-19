import { useState } from "react";
import { type ColorValue, Text, View } from "react-native";
import {
  Link,
  Tabs,
  useGlobalSearchParams,
  usePathname,
  useRouter,
} from "expo-router";
import { AppHeader } from "../../components/AppHeader";
import { CreateSheet } from "../../components/CreateSheet";
import { newActionFor } from "../../lib/new-action";
import { useHasAccount } from "../../lib/use-has-account";
import { colors, styles } from "../../lib/styles";

/**
 * The app's bottom tab bar: **Home, Search, New, Settings/Account**.
 *
 * Three of those are places and one is a verb. The bar is built around what a
 * user does rather than what the app stores, which is why there is no People tab
 * — People & Pets is the biggest catalog in the app, but a catalog is somewhere
 * you go to find a particular record, and finding is Search's job. Search's
 * browse tiles lead there, and so does every reference from another entity.
 *
 * Everything except the three real tabs lives on the root stack, so navigating
 * into one pushes full-screen over the tabs — the standard pattern. That covers
 * People & Pets, the detail screens, the holidays/gifts/tags catalogs, and
 * Account.
 *
 * There is no hamburger menu and no floating action button: New lives in the bar
 * with everything else, so nothing hovers over content and nothing is hidden
 * behind an icon that has to be learned.
 *
 * Tab icons are plain emoji `<Text>` rather than a vector-icon font, keeping the
 * dependency budget (no `@expo/vector-icons`); the `color` follows focus. A
 * drawn icon set is its own later pass.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 22, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  // **Global**, not local: `useLocalSearchParams` in a layout returns that
  // layout's own params, and the `(tabs)` route has none — so the search tab's
  // `?type=` was invisible from here and New always fell back to the chooser.
  // The global hook reads whichever route is actually focused. Its usual hazard,
  // that it keeps params from a screen you have since left, is closed by
  // `newActionFor` only consulting `type` when the pathname is the search tab.
  const params = useGlobalSearchParams<{ type?: string }>();
  const [choosing, setChoosing] = useState(false);
  const hasAccount = useHasAccount();

  return (
    <>
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
            tabBarButtonTestID: "tab-home",
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
        {/*
          The one tab with no header. Everywhere else the title answers "where am
          I?", but here the search field itself is the answer — a field with a
          "Search…" placeholder sitting where the title would be says the same
          word twice if the title is also drawn. So the screen draws its own top
          inset (app/(tabs)/search.tsx) and the field takes the title's place.

          `tabBarLabel` is therefore explicit rather than inherited from `title`:
          the bar still has to read "Search", and maestro/global-nav.yaml and
          maestro/ios-prepare.yaml both gate on that word.
        */}
        <Tabs.Screen
          name="search"
          options={{
            headerShown: false,
            tabBarLabel: "Search",
            tabBarButtonTestID: "tab-search",
            tabBarIcon: ({ color }) => <TabIcon glyph="🔍" color={color} />,
          }}
        />
        {/*
          New never navigates. `preventDefault` cancels the press, so the route
          behind it (app/(tabs)/new.tsx) never mounts and the tab never becomes
          focused — which is also why it can never draw a selected state: the
          active tint follows focus, and focus never arrives. Nothing has to
          remember to suppress it.

          What the press does instead depends on the screen it was made from,
          and that table lives in lib/new-action.ts where a test holds it still.
        */}
        <Tabs.Screen
          name="new"
          options={{
            tabBarLabel: "New",
            // Load-bearing for maestro/global-nav.yaml, not decoration: the tab
            // labels are matched as loose regexes and "New" is a word that can
            // appear in a reminder on the list behind the bar.
            tabBarButtonTestID: "tab-new",
            tabBarIcon: ({ color }) => <TabIcon glyph="➕" color={color} />,
          }}
          listeners={{
            tabPress: (event) => {
              event.preventDefault();
              const action = newActionFor(pathname, params);
              if (action.kind === "route") router.push(action.href);
              else setChoosing(true);
            },
          }}
        />
        {/*
          One tab, two names. Signed out it is Settings — a place for the app's
          switches, with an invitation to make an account among them. Signed in
          it is Account, because that is what a user is looking for once they
          have one, and burying it under "Settings" would be hiding the thing
          they came for.

          There is no separate always-visible account affordance anywhere else,
          which is the point: an account is optional, so a permanent sign-in
          prompt would be a wall where the product promises a nudge.
        */}
        <Tabs.Screen
          name="menu"
          options={{
            title: hasAccount === true ? "Account" : "Settings",
            tabBarButtonTestID: "tab-account",
            tabBarIcon: ({ color }) => (
              <TabIcon
                glyph={hasAccount === true ? "👤" : "⚙️"}
                color={color}
              />
            ),
          }}
        />
      </Tabs>
      <CreateSheet visible={choosing} onClose={() => setChoosing(false)} />
    </>
  );
}
