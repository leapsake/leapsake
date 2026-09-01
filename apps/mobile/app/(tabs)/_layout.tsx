import { type ColorValue, Text, View } from "react-native";
import { Tabs } from "expo-router";
import { AppHeader } from "../../components/AppHeader";
import { NewLink } from "../../components/NewLink";
import { SearchHereLink } from "../../components/SearchHereLink";
import { colors, styles } from "../../lib/styles";

/**
 * The app's bottom tab bar: **Home, Search, People, Settings**.
 *
 * Four destinations and no verb. The bar was briefly built around what a user
 * *does* rather than what the app stores — Home, Search, **New**, Account — with
 * People demoted to a catalog reachable through Search's browse tiles. Creating
 * did belong in the bar under that reading, but the price was paid by the wrong
 * screen: People & Pets is the biggest thing in the app and the thing it is
 * mostly *about*, and putting the most-visited list behind a tile made a
 * one-tap destination a two-tap trip. A bar of four places, with creating in
 * each place's own corner, costs the create action nothing it was actually
 * using.
 *
 * There is no hamburger menu and no floating action button.
 *
 * ### Creating is a screen's job, so the header does it
 *
 * Home, People & Pets and Gifts each carry a **➕** in the top-right corner that
 * makes the one thing that screen is about — a reminder, a person or pet, a gift
 * idea. The table is right here beside each screen's title rather than in a
 * resolver keyed by pathname: three screens, each stating its own answer, and no
 * way for a screen to be in the bar without saying what ➕ means on it.
 *
 * That retires the chooser sheet entirely. It existed because one control had to
 * serve every screen and therefore had to ask "what are you adding?" on the ones
 * that were about everything — and Home, which is where it asked most often, is a
 * reminders list that had already answered.
 *
 * **Holidays and Tags carry no ➕**, because there is nothing to author: a holiday
 * comes from a seeded catalog, a tag exists only because something wears it. See
 * {@link NewLink}.
 *
 * A **form's** header is untouched: Save is not a create action, it is the end of
 * one, and `components/HeaderSave.tsx` still puts it top-right.
 *
 * ### Search stays a tab, and stays reachable from inside a catalog
 *
 * Each catalog also carries a **🔍** that opens Search already narrowed to what
 * the catalog holds ({@link SearchHereLink}), for the user who has decided that
 * scrolling isn't working. On People and Gifts the two glyphs sit side by side in
 * the one right-hand slot, which is why both are glyphs rather than words — see
 * `components/AppHeader.tsx` for how one row now holds the title and its actions.
 *
 * The one thing this shape gives up: a *filtered* search no longer offers a
 * create action. It used to, through the New tab reading `?type=`. The search
 * screen has no header to put a ➕ in — its field takes the title's place — and
 * the catalog behind every filter is one tap away with its own.
 *
 * ### The three remaining catalogs are in this navigator, without a button
 *
 * Gifts, Holidays and Tags (the `href: null` screens at the foot of this file)
 * are hidden members of *this* navigator rather than root-stack screens, so the
 * global nav stays on screen while you browse one — a catalog is a place you
 * arrive at and then leave sideways ("actually, Home"), not a modal you have to
 * dismiss. People was the fourth until it took a seat in the bar; nothing else
 * about it changed.
 *
 * Two consequences, both intended:
 *
 *   - **No tab draws as selected while one of the three is up.** None of the four
 *     buttons owns these routes. The bar is a way *out*, not a breadcrumb.
 *   - **They carry no back control**, because this navigator's header renderer
 *     has no `back` to hand {@link AppHeader} (see its "Back is the navigator's
 *     decision" note). That is the same mechanism that keeps Back off Home and
 *     Search, and it is also what lets the header put its actions on the title's
 *     line: the corner that holds 🔍 and ➕ can never also be holding a Back.
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

/**
 * The 🔍 and ➕ a catalog carries, handed to the header as the one node its right
 * slot takes. The header stays ignorant of how many actions a screen has.
 */
function CatalogActions({
  category,
  create,
}: {
  category: string;
  create: { href: string; what: string };
}) {
  return (
    <View style={styles.headerActions}>
      <SearchHereLink category={category} />
      <NewLink
        href={create.href}
        what={create.what}
        testID={`header-new-${category}`}
      />
    </View>
  );
}

export default function TabsLayout() {
  return (
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
        // three catalogs below — can show a back control.
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
      {/*
        Home is the reminders list, so its ➕ makes a reminder and asks nothing.
        It carries no 🔍 — reminders are not one of Search's categories, and there
        is no "search here" to offer from a screen that isn't a catalog.
      */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Leapsake",
          tabBarLabel: "Home",
          tabBarButtonTestID: "tab-home",
          tabBarIcon: ({ color }) => <TabIcon glyph="🏠" color={color} />,
          headerRight: () => (
            <NewLink
              href="/reminders/new"
              what="reminder"
              testID="header-new-home"
            />
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
        The bar says "People" and the screen says "People & Pets". The tab label
        is a word under a glyph in a four-across bar, where the ampersand costs
        more room than it earns; the title has the width to be exact, and being
        exact is what tells a user their dog belongs in there too.
      */}
      <Tabs.Screen
        name="people"
        options={{
          title: "People & Pets",
          tabBarLabel: "People",
          tabBarButtonTestID: "tab-people",
          tabBarIcon: ({ color }) => <TabIcon glyph="👥" color={color} />,
          headerRight: () => (
            <CatalogActions
              category="people"
              create={{ href: "/add", what: "person or pet" }}
            />
          ),
        }}
      />
      {/*
        Settings, in both custody states. It was Settings-or-Account for a while,
        following whether an account existed — the idea being that a user who has
        one is looking for it by that name. But the screen behind the tab is a
        *menu* whose first row is already "Account" in both states
        (app/(tabs)/menu.tsx), so the rename put the same word in two places and
        made the bar's fourth button change identity under a user who hadn't asked
        it to. The tab is the box; Account is a thing in the box.
      */}
      <Tabs.Screen
        name="menu"
        options={{
          title: "Settings",
          tabBarButtonTestID: "tab-settings",
          tabBarIcon: ({ color }) => <TabIcon glyph="⚙️" color={color} />,
        }}
      />
      {/*
        The three remaining catalogs, hosted here but absent from the bar —
        `href: null` is expo-router's shortcut for "a route in this navigator with
        no button", which is exactly the shape wanted: the bar keeps its four
        places while these keep the bar.

        Their titles and header actions are declared **here** rather than in each
        screen, unlike when they were stack screens setting their own. `href: null`
        has to be stated in this file, and a screen whose "am I on the bar?" lives
        here while its name lives there is a screen you have to read twice.

        Gifts gets both glyphs. Holidays and Tags get only 🔍, because neither
        holds anything a user authors — see {@link NewLink}.
      */}
      <Tabs.Screen
        name="gifts"
        options={{
          href: null,
          title: "Gifts",
          headerRight: () => (
            <CatalogActions
              category="gifts"
              create={{ href: "/gifts/new", what: "gift idea" }}
            />
          ),
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
  );
}
