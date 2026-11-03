import type { ComponentType } from "react";
import { Redirect } from "expo-router";

// Decided at bundle time: a store build never contains the screen's module.
const Screen: ComponentType | null =
  __DEV__ || process.env.EXPO_PUBLIC_SYNC === "1"
    ? require("../sync/screens/sync-settings").default
    : null;

export default function SyncRoute() {
  return Screen === null ? <Redirect href="/" /> : <Screen />;
}
