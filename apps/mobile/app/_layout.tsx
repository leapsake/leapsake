import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppHeader } from "../components/AppHeader";
import { CoreProvider } from "../lib/core-context";
import { colors } from "../lib/styles";

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
                title={options.title ?? route.name}
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
                onBack={
                  back === undefined ? undefined : () => navigation.goBack()
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
    </SafeAreaProvider>
  );
}
