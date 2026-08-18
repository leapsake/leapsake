import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CoreProvider } from "../lib/core-context";
import { colors } from "../lib/styles";

// Root layout: build the core once (CoreProvider gates rendering on it being
// ready) and host a native stack. The `(tabs)` group is a bottom-tab navigator
// that supplies its own per-tab headers, so the root stack hides its header for
// that route to avoid a doubled header bar. Every other route (people/[id],
// pets/[id], relationships, tags, the holidays and gifts catalogs, settings) is a
// stack screen that pushes full-screen over the tabs and sets its own title via
// <Stack.Screen options={{ title }} />.
//
// The group carries a `title` despite hiding its own header, because a native
// stack labels its back button with the *previous* screen's title: without one it
// falls back to the route name and every pushed screen reads "‹ (tabs)". Which
// tab you came from can't be named from here, so "Back" — the iOS generic — is
// the honest label.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <CoreProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.surfaceRaised },
            headerTintColor: colors.accent,
            headerTitleStyle: { color: colors.text },
            headerShadowVisible: false,
            // The scene behind every pushed screen. Screens paint `styles.screen`
            // themselves, but a ScrollView bounces past its own content and the
            // navigator's background is what shows underneath.
            contentStyle: { backgroundColor: colors.surface },
          }}
        >
          <Stack.Screen
            name="(tabs)"
            options={{ headerShown: false, title: "Back" }}
          />
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
