import type { ExportArchive } from "@leapsake/core";

/** Every side effect saving an export has, and no more. */
export interface SaveExportDeps {
  /** `core.export.archive`, already bound to this app's version. */
  archive: () => Promise<ExportArchive>;
  /** Asks where to save `filename`; `null` when the user cancels. */
  choosePath: (filename: string) => Promise<string | null>;
  write: (path: string, bytes: Uint8Array) => Promise<void>;
}

/** Builds the archive and saves it where the user picks; `null` if they
 *  cancelled, so nothing was written. */
export async function saveExport(
  deps: SaveExportDeps,
): Promise<ExportArchive["counts"] | null> {
  const { bytes, filename, counts } = await deps.archive();
  const path = await deps.choosePath(filename);
  if (path === null) return null;
  await deps.write(path, bytes);
  return counts;
}
