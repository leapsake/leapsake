import type { ComponentProps } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Stack } from "expo-router";
import { styles } from "../lib/styles";

type HeaderOptions = ComponentProps<typeof Stack.Screen>["options"];

/**
 * A screen whose data is not ready: the load's error, else `missing` once
 * loading is over, else a spinner. `header` mounts the screen's title too.
 */
export function LoadState({
  error,
  loading = true,
  missing,
  header,
}: {
  error: string | null;
  loading?: boolean;
  missing?: string;
  header?: HeaderOptions;
}) {
  return (
    <View style={styles.screen}>
      {header !== undefined && <Stack.Screen options={header} />}
      {error !== null ? (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      ) : loading || missing === undefined ? (
        <ActivityIndicator />
      ) : (
        <Text style={styles.danger}>{missing}</Text>
      )}
    </View>
  );
}
