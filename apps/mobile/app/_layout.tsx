import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CoreProvider } from "../lib/core-context";

// Root layout: build the core once (CoreProvider gates rendering on it being
// ready) and host a native stack. The `(tabs)` group is a bottom-tab navigator
// that supplies its own per-tab headers, so the root stack hides its header for
// that route to avoid a doubled header bar. Every other route (people/[id],
// pets/[id], relationships, tags) is a stack screen that pushes full-screen over
// the tabs and sets its own title via <Stack.Screen options={{ title }} />.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <CoreProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
        <StatusBar style="auto" />
      </CoreProvider>
    </SafeAreaProvider>
  );
}
