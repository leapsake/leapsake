import type { ComponentType } from "react";
import { MessagesProvider, en } from "@leapsake/ui/messages";
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

// The root stack: lists live in `(tabs)`, and each record pushes here, over
// the bar. Both draw `AppHeader`, which does not animate with a push.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <MessagesProvider messages={en}>
        <CoreProvider>
          <Stack
            screenOptions={{
              header: ({ options, route, back, navigation }) => (
                <AppHeader
                  // Until a screen's data names it, the name its link sent.
                  title={headerTitle(options, route)}
                  left={options.headerLeft?.({
                    canGoBack: back !== undefined,
                    tintColor: colors.accent,
                  })}
                  right={options.headerRight?.({
                    canGoBack: back !== undefined,
                    tintColor: colors.accent,
                  })}
                  // No `back` at a stack's root; a screen with its own single
                  // way on also opts out with `headerBackVisible: false`.
                  onBack={
                    back === undefined || options.headerBackVisible === false
                      ? undefined
                      : () => navigation.goBack()
                  }
                />
              ),
              // What shows when a ScrollView bounces past its own content.
              contentStyle: { backgroundColor: colors.surface },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
          {/* Dark, not "auto": the app is light whatever the OS theme. */}
          <StatusBar style="dark" />
        </CoreProvider>
      </MessagesProvider>
      {ConsoleErrorMarker && <ConsoleErrorMarker />}
    </SafeAreaProvider>
  );
}
