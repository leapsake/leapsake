import { useSyncExternalStore } from "react";
import { View } from "react-native";
import { TEST_ONLY_MARKER } from "./test-only";

let firstError: string | null = null;
const listeners = new Set<() => void>();

const original = console.error;
console.error = (...args: unknown[]) => {
  if (firstError === null) {
    firstError = args.map(String).join(" ");
    for (const listener of listeners) listener();
  }
  original(...args);
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Once anything calls `console.error`, renders a `console-error` element
 *  labelled with the first message; the E2E harness fails a flow on it. */
export default function ConsoleErrorMarker() {
  const message = useSyncExternalStore(subscribe, () => firstError);
  if (message === null) return null;
  return (
    <View
      nativeID={TEST_ONLY_MARKER}
      testID="console-error"
      accessible
      accessibilityLabel={message}
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 8,
        height: 8,
        backgroundColor: "red",
      }}
    />
  );
}
