import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CoreProvider } from "../lib/core-context";

// Root layout: build the core once (CoreProvider gates rendering on it being
// ready) and host a native stack. Per-screen titles are set on each screen via
// <Stack.Screen options={{ title }} />.
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <CoreProvider>
        <Stack />
        <StatusBar style="auto" />
      </CoreProvider>
    </SafeAreaProvider>
  );
}
