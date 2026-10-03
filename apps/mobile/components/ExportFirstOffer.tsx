import { useState } from "react";
import { Text } from "react-native";
import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useMessages } from "@leapsake/ui/messages";
import { useCore } from "../lib/core-context";
import { exportAndShare } from "../lib/export-share";
import { styles } from "../lib/styles";
import { Button } from "./Button";

/** The release version stamped into the archive, else the core version. */
const APP_VERSION =
  Constants.expoConfig?.extra?.release ??
  Constants.expoConfig?.version ??
  "unknown";

/**
 * The expo wiring for `exportAndShare`. ⚠️ Never iCloud, and no
 * `expo-sharing` plugin: `@leapsake/export` → It must never use iCloud.
 */
export function useExportShare() {
  const core = useCore();
  const m = useMessages();
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (working) return;
    setError(null);
    setResult(null);
    setWorking(true);
    try {
      const held = await exportAndShare({
        archive: () => core.export.archive({ appVersion: APP_VERSION }),
        // Caches, not documents: see `export-share.ts`.
        write: (filename, bytes) => {
          const file = new File(Paths.cache, filename);
          if (file.exists) file.delete(); // a second export the same day
          file.write(bytes);
          return {
            uri: file.uri,
            remove: () => {
              if (file.exists) file.delete();
            },
          };
        },
        canShare: () => Sharing.isAvailableAsync(),
        share: (uri) =>
          Sharing.shareAsync(uri, {
            mimeType: "application/zip",
            UTI: "public.zip-archive",
            dialogTitle: "Save your Leapsake export",
          }),
      });
      setResult(m.dataExport.summary(held));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't export your data.",
      );
    } finally {
      setWorking(false);
    }
  }

  return { working, result, error, run: () => void run() };
}

/**
 * The export, offered inside a destructive confirmation, above its typed
 * field. `busy` means the destruction is already running.
 */
export function ExportFirstOffer({ busy = false }: { busy?: boolean }) {
  const { working, result, error, run } = useExportShare();

  return (
    <>
      <Button
        testID="export-first-start"
        label={working ? "Preparing…" : "Export data first"}
        busy={working || busy}
        onPress={run}
      />
      {result !== null && (
        <Text testID="export-first-result" style={styles.muted}>
          {result}
        </Text>
      )}
      {error !== null && (
        <Text style={styles.danger} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </>
  );
}
