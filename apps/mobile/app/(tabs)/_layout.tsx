import { useState } from "react";
import { type ColorValue, Text } from "react-native";
import {
  Tabs,
  useGlobalSearchParams,
  usePathname,
  useRouter,
} from "expo-router";
import { AppHeader } from "../../components/AppHeader";
import { CreateSheet } from "../../components/CreateSheet";
import { SearchHereLink } from "../../components/SearchHereLink";
import { newActionFor } from "../../lib/new-action";
import { useHasAccount } from "../../lib/use-has-account";
import { colors } from "../../lib/styles";

/**
 * The app's bottom tab bar: **Home, Search, New, Settings/Account**.
 *
 * Three of those are places and one is a verb. The bar is built around what a
 * user does rather than what the app stores, which is why there is no People tab
 * — People & Pets is the biggest catalog in the app, but a catalog is somewhere
 * you go to find a particular record, and finding is Search's job. Search's
 * browse tiles lead there, and so does every reference from another entity.
 *
 * There is no hamburger menu and no floating action button: New lives in the bar
 * with everything else, so nothing hovers over content and nothing is hidden
 * behind an icon that has to be learned.
 *
 * ### Creating is the bar's job, so no header does it
 *
 * Home, People & Pets and Gifts each used to carry a "+ Add" in the top-right
 * corner. They don't, because New in the bar already goes exactly where each of
 * those went — `lib/new-action.ts` resolves it against the screen you're on — and
 * two controls for one action is one of them a user has to rule out. The bar's
 * copy of it is the better one besides: bottom-right of a phone is where a thumb
 * already is, and top-right is where it isn't.
 *
 * The trade is on **Home**, where New asks "what are you adding?" rather than
 * assuming a reminder the way its "+ Add" did — a tap more, on the one screen
 * that genuinely holds more than one kind of thing. An empty Home still names the
 * action outright (`components/EmptyState.tsx`), which is where the shortcut was
 * worth most.
 *
 * A **form's** header is untouched: Save is not a create action, it is the end of
 * one, and `components/HeaderSave.tsx` still puts it top-right.
 *
 * ### The four catalogs are in this navigator, without a button
 *
 * People & Pets, Gifts, Holidays and Tags (the four `href: null` screens at the
 * foot of this file) used to be root-stack screens that pushed full-screen over
 * the bar. They are hidden members of *this* navigator instead, so the global
 * nav stays on screen while you browse one — a catalog is a place you arrive at
 * and then leave sideways ("actually, Home"), not a modal you have to dismiss.
 *
 * Two consequences, both intended:
 *
 *   - **No tab draws as selected while a catalog is up.** None of the four
 *     buttons owns these routes. The bar is a way *out*, not a breadcrumb.
 *   - **They carry no back control**, because this navigator's header renderer
 *     has no `back` to hand {@link AppHeader} (see its "Back is the navigator's
 *     decision" note). That is the same mechanism that keeps Back off Home and
 *     Search, now applied to four more screens on purpose.
 *
 * Their *detail* screens — `people/[id]`, `gifts/[id]/edit`, `holidays/[id]`,
 * `tags/[id]` — stay on the root stack and still push over the bar with a Back.
 * The rule that fell out: a **list** is a destination the bar can reach, a
 * **record** is a push you come back from.
 *
 * `backBehavior: "history"` follows from that. The bottom-tab default,
 * `firstRoute`, sends Android's hardware back to Home from anywhere — fine when
 * every screen with real history was a stack push, wrong now that arriving at
 * Tags from Search is a move within this navigator and the header offers nothing
 * to undo it with.
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
        backBehavior="history"
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
          // here and there is nothing to pass one from: this navigator has no back
          // destination to offer, so nothing hosted in it — the four tabs or the
          // four catalogs below — can show a back control.
          //
          // This also retires `headerRightContainerStyle`, which existed only to
          // undo the bottom-tab navigator's missing edge inset — AppHeader insets
          // both edges itself.
          //
          // `showLogo` is decided here, by route, rather than offered as a screen option:
          // react-navigation's options are a fixed shape, and the alternative — smuggling a
          // custom key through it — would be a second, weaker way to say something this
          // navigator already knows. Home is the only title that is the app's *name*
          // (below), so it is the only one the mark belongs to.
          header: ({ options, route }) => (
            <AppHeader
              title={options.title ?? route.name}
              showLogo={route.name === "index"}
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
        {/*
          The four catalogs, hosted here but absent from the bar — `href: null`
          is expo-router's shortcut for "a route in this navigator with no
          button", which is exactly the shape wanted: the bar keeps its four
          verbs-and-places while these keep the bar.

          Their titles and header actions are declared **here** rather than in
          each screen, unlike when they were stack screens setting their own.
          `href: null` has to be stated in this file, and a screen whose "am I on
          the bar?" lives here while its name lives there is a screen you have to
          read twice. What each carries is its way into a narrowed Search
          (`SearchHereLink`), which is a fixed property of the catalog.
        */}
        <Tabs.Screen
          name="people"
          options={{
            href: null,
            title: "People & Pets",
            headerRight: () => <SearchHereLink category="people" />,
          }}
        />
        <Tabs.Screen
          name="gifts"
          options={{
            href: null,
            title: "Gifts",
            headerRight: () => <SearchHereLink category="gifts" />,
          }}
        />
        <Tabs.Screen
          name="holidays"
          options={{
            href: null,
            title: "Holidays",
            headerRight: () => <SearchHereLink category="holidays" />,
          }}
        />
        <Tabs.Screen
          name="tags"
          options={{
            href: null,
            title: "Tags",
            headerRight: () => <SearchHereLink category="tags" />,
          }}
        />
      </Tabs>
      <CreateSheet visible={choosing} onClose={() => setChoosing(false)} />
    </>
  );
}
