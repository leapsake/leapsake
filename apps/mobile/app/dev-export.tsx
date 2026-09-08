import { useEffect, useState } from "react";
import { ScrollView, Text } from "react-native";
import { Redirect, Stack } from "expo-router";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * Dev-only: run the export **on mount** and write the archive to a known path,
 * so the whole path can be verified out of band without a tap.
 *
 * The real Export button (`app/data.tsx`) opens the system share sheet, which no
 * shell-driven harness can dismiss — there is no tap or share-sheet command for
 * the simulator. This route runs everything up to that point and stops: it
 * proves `core.export.archive` executes **on Hermes** (which is the part Node
 * tests say nothing about — `fflate` deflating a real store is the risk), that
 * `File.write` lands the bytes, and that what lands is a readable zip.
 *
 * Deep link only (`leapsake://dev-export`), `__DEV__`-gated, no link from any
 * shipping screen — the same shape as `dev-clear-dbkey.tsx`.
 */
export default function DevExportScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DevExport />;
}

function DevExport() {
  const core = useCore();
  const [line, setLine] = useState("running…");

  useEffect(() => {
    void (async () => {
      try {
        const { bytes, filename, counts } = await core.export.archive({
          appVersion: Constants.expoConfig?.version ?? "unknown",
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
      <ScrollView contentContainerStyle={styles.screen}>
        <Text testID="dev-export-status" style={styles.rowText}>
          {line}
        </Text>
      </ScrollView>
    </>
  );
}
