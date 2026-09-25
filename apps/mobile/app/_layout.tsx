import type { ComponentType } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppHeader } from "../components/AppHeader";
import { CoreProvider } from "../lib/core-context";
import { headerTitle } from "../lib/record-title";
import { colors } from "../lib/styles";

// Decided when the bundle is built, so a store bundle leaves the module out.
const ConsoleErrorMarker: ComponentType | null =
  __DEV__ || process.env.EXPO_PUBLIC_E2E === "1"
    ? require("../test/console-error-marker").default
    : null;

// Root layout: build the core once (CoreProvider gates rendering on it being
// ready) and host a native stack. The `(tabs)` group is a bottom-tab navigator
// that supplies its own per-screen headers, so the root stack hides its header
// for that route to avoid a doubled header bar. Every other route (people/[id],
// pets/[id], relationships, tags/[id], holidays/[id], gift editing, settings) is
// a stack screen that pushes full-screen over the tabs and sets its own title via
// <Stack.Screen options={{ title }} />.
//
// The split is **list vs record**, not "tab vs everything else": the four
// catalogs (People & Pets, Gifts, Holidays, Tags) live inside `(tabs)` without a
// button so the bar stays under them, while the record each row opens pushes
// here. See `app/(tabs)/_layout.tsx` for why.
//
// The header those screens get is **ours** (components/AppHeader.tsx), swapped in
// here for the platform's, so iOS and Android draw the same chrome. Screens are
// unaffected: they still declare `title` and `headerRight` exactly as before, and
// this adapter is the only thing that reads them.
//
// Two things the native header did for free, and what replaced them:
//
//   - **Naming the back button after the previous screen.** Gone on purpose —
//     every pushed screen now reads a plain "‹ Back", so the `title: "Back"` the
//     `(tabs)` group carried to avoid "‹ (tabs)" is no longer needed, and neither
//     is the `from` param screens used to pass to name it.
//   - **Animating with the push transition.** A JS header cannot; the back
//     *gesture* is untouched. That is the accepted cost of one design.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <CoreProvider>
        <Stack
          screenOptions={{
            header: ({ options, route, back, navigation }) => (
              <AppHeader
                // A screen names itself from its own data, so it has no title
                // until that data arrives — and this is what it wears in the
                // meantime. **Never `route.name`**, which is what it used to be:
                // that put "reminders/[id]/index" in the one place on screen
                // whose job is to answer "where am I?".
                //
                // What it wears instead is the name the screen that linked here
                // sent (`lib/record-title.ts`, which owns the rule and is tested
                // on it), which for a record opened from a list, a chip or a
                // mention is already the right one — so the load is a titled
                // screen rather than a bare bar that fills in. Reading it here
                // rather than in each screen is what makes it free: a screen
                // still loading has declared no options at all. With no name
                // sent, an empty title draws no title element (see AppHeader) and
                // the bar is simply bare for that beat.
                title={headerTitle(options, route)}
                left={options.headerLeft?.({
                  canGoBack: back !== undefined,
                  tintColor: colors.accent,
                })}
                right={options.headerRight?.({
                  canGoBack: back !== undefined,
                  tintColor: colors.accent,
                })}
                // `back` is undefined at the root of the stack, which is what
                // keeps a back control off the tab roots without any screen
                // having to say so.
                //
                // `headerBackVisible: false` is the one way a screen opts out on
                // top of that, and it is react-navigation's own option rather
                // than an invention — the native header honours it too, so a
                // screen says this once and means it whoever draws the bar. It
                // is for a screen that offers its **own** single way on, where
                // Back would be a second control for one decision: today only
                // the finished state of `app/import.tsx`.
                onBack={
                  back === undefined || options.headerBackVisible === false
                    ? undefined
                    : () => navigation.goBack()
                }
              />
            ),
            // The scene behind every pushed screen. Screens paint `styles.screen`
            // themselves, but a ScrollView bounces past its own content and the
            // navigator's background is what shows underneath.
            contentStyle: { backgroundColor: colors.surface },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        {/*
          Pinned dark, not "auto". The app has one palette and it is a light,
          warm one (app.json pins `userInterfaceStyle` to match), so "auto" would
          read the *OS* theme and paint light status-bar content over a light
          header the moment the phone is in dark mode.
        */}
        <StatusBar style="dark" />
      </CoreProvider>
      {ConsoleErrorMarker && <ConsoleErrorMarker />}
    </SafeAreaProvider>
  );
}
