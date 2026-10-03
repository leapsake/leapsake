import type { ExportArchive } from "@leapsake/core";

// Build an export, hand it to the share sheet, and leave nothing behind:
// shared by every Export button, so its order is written once.

/** Every side effect this sequence has, and no more. */
export interface ExportShareDeps {
  /** `core.export.archive`, already bound to this app's version. */
  archive: () => Promise<ExportArchive>;
  /**
   * ⚠️ Writes to Caches, never documents: Caches is excluded from device
   * backup, so the plaintext archive never rides along to iCloud.
   */
  write: (
    filename: string,
    bytes: Uint8Array,
  ) => { uri: string; remove: () => void };
  /** Whether this device can share a file at all. */
  canShare: () => Promise<boolean>;
  /** Opens the system share sheet, resolving once it is done with the file. */
  share: (uri: string) => Promise<void>;
}

/** A device that cannot share has nowhere to put the file. */
export class SharingUnavailable extends Error {
  constructor() {
    super("Sharing isn't available on this device.");
    this.name = "SharingUnavailable";
  }
}

/**
 * Runs one export and resolves to what it held. Resolving means the archive
 * was offered, not that it was kept.
 */
export async function exportAndShare(
  deps: ExportShareDeps,
): Promise<ExportArchive["counts"]> {
  const { bytes, filename, counts } = await deps.archive();

  const file = deps.write(filename, bytes);
  try {
    if (!(await deps.canShare())) throw new SharingUnavailable();
    await deps.share(file.uri);
    return counts;
  } finally {
    // The archive is plaintext, so it goes on every path out. iOS resolves
    // `shareAsync` after the chosen activity has its copy, so this is no race.
    try {
      file.remove();
    } catch {
      // A file we cannot delete is not a reason to fail an export that worked;
      // Caches is reclaimed by the system anyway.
    }
  }
}
