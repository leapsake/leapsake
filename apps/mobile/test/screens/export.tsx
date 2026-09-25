import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { Stack } from "expo-router";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import { useCore } from "../../lib/core-context";
import { styles } from "../../lib/styles";
import { TEST_ONLY_MARKER } from "../test-only";

/**
 * Runs the export on mount and writes the archive to `dev-export.zip` in the cache, so the
 * whole path can be checked from outside without the share sheet.
 */
export default function DevExport() {
  const core = useCore();
  const [line, setLine] = useState("running…");

  useEffect(() => {
    void (async () => {
      try {
        const { bytes, filename, counts } = await core.export.archive({
          appVersion:
            Constants.expoConfig?.extra?.release ??
            Constants.expoConfig?.version ??
            "unknown",
        });
        // A fixed name, unlike the real flow's dated one, so the out-of-band
        // check knows where to look without guessing the day.
        const out = new File(Paths.cache, "dev-export.zip");
        if (out.exists) out.delete();
        out.write(bytes);
        setLine(
          `OK ${filename} people=${counts.people} pets=${counts.pets} methods=${counts.contactMethods} other=${counts.otherRecords} bytes=${counts.bytes}`,
        );
      } catch (cause) {
        setLine(`FAIL ${cause instanceof Error ? cause.message : cause}`);
      }
    })();
  }, [core]);

  return (
    <>
      <Stack.Screen options={{ title: "Export (dev)" }} />
      <ScrollView
        nativeID={TEST_ONLY_MARKER}
        contentContainerStyle={styles.screen}
      >
        <Text testID="dev-export-status" style={styles.rowText}>
          {line}
        </Text>
      </ScrollView>
    </>
  );
}
