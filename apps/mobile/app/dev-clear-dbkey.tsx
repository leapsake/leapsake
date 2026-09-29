import type { ComponentType } from "react";
import { Platform } from "react-native";
import { Redirect } from "expo-router";

// Decided at bundle time: beyond the dev client only Android E2E builds carry
// it, since iOS flows clear keys with Maestro's `clearKeychain`.
const Screen: ComponentType | null =
  __DEV__ || (process.env.EXPO_PUBLIC_E2E === "1" && Platform.OS === "android")
    ? require("../test/screens/clear-keys").default
    : null;

export default function DevClearKeysRoute() {
  return Screen === null ? <Redirect href="/" /> : <Screen />;
}
