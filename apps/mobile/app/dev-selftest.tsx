import type { ComponentType } from "react";
import { Redirect } from "expo-router";

// Decided when the bundle is built: a store build never contains the screen's module.
const Screen: ComponentType | null =
  __DEV__ || process.env.EXPO_PUBLIC_E2E === "1"
    ? require("../test/screens/driver-selftest").default
    : null;

export default function DevSelfTestRoute() {
  return Screen === null ? <Redirect href="/" /> : <Screen />;
}
