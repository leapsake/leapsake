import type { ExportArchive } from "@leapsake/core";

/**
 * **Build an export, hand it to the platform, and leave nothing behind** — the
 * sequence behind every Export button on the Data screen.
 *
 * It lives here, injected rather than importing `expo-file-system` and
 * `expo-sharing` directly, for the reason the rest of `lib/` does
 * ({@link ./forget-account.ts}, {@link ./notification-permission.ts}): the order
 * of these steps is the part that can be wrong, and this is the only tier that
 * can test it. Nothing in `app/` is reachable from vitest.
 *
 * There are three call sites — the Export section, and the offer inside each
 * destructive confirmation — and two of the steps
 * below are load-bearing rather than incidental, so they must not be forked:
 * writing to **Caches** rather than documents, and deleting the file on **every**
 * path out.
 */

/** What the caller must supply. Every side effect this sequence has, and no more. */
export interface ExportShareDeps {
  /** `core.export.archive({ appVersion })`, already bound to this app's version. */
  archive: () => Promise<ExportArchive>;
  /**
   * Writes the bytes somewhere the share sheet can point at, and hands back the
   * URI plus the cleanup that {@link exportAndShare} promises to run.
   *
   * ⚠️ **Caches, never the documents directory**, and that is load-bearing rather
   * than tidiness: `Library/Caches` is excluded from device backup, so a plaintext
   * dump of the user's whole address book can never ride along inside an iCloud
   * device backup. Writing it to documents is the one way this feature could
   * violate the no-iCloud constraint by accident.
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

/** A device that cannot share has nowhere to put the file, so there is no export. */
export class SharingUnavailable extends Error {
  constructor() {
    super("Sharing isn't available on this device.");
    this.name = "SharingUnavailable";
  }
}

/**
 * Runs one export end to end and resolves to the line the caller shows.
 *
 * Built in memory, written once, shared, and deleted — the file exists only for
 * as long as the share sheet needs a URL to point at.
 *
 * Note what this cannot tell you: `share` resolves whether the user saved the
 * file or backed out of the sheet, so a resolved promise means "the archive was
 * offered", not "the archive was kept".
 */
export async function exportAndShare(deps: ExportShareDeps): Promise<string> {
  const { bytes, filename, counts } = await deps.archive();

  const file = deps.write(filename, bytes);
  try {
    if (!(await deps.canShare())) throw new SharingUnavailable();
    await deps.share(file.uri);
    return summarizeExport(counts);
  } finally {
    // On dismiss, whether the share succeeded, failed or the user backed out:
    // the archive is plaintext, so it does not sit in the container waiting to
    // be found. Deleting this promptly is safe rather than a race — on iOS
    // `shareAsync` resolves from `UIActivityViewController`'s completion
    // handler, which fires after the chosen activity has finished with the
    // file, so Files and AirDrop have their copy by the time we get here.
    try {
      file.remove();
    } catch {
      // A file we cannot delete is not a reason to fail an export that worked;
      // Caches is reclaimed by the system anyway.
    }
  }
}

/** What actually left the device, in one line, for a human and for the E2E assertion. */
export function summarizeExport(counts: ExportArchive["counts"]): string {
  const kb = Math.max(1, Math.round(counts.bytes / 1024));
  return (
    `Exported ${counts.people} ${counts.people === 1 ? "person" : "people"}` +
    `, ${counts.pets} ${counts.pets === 1 ? "pet" : "pets"}` +
    `, ${counts.contactMethods} contact ${
      counts.contactMethods === 1 ? "method" : "methods"
    }` +
    // The rest of the archive — reminders, gift ideas, holiday choices,
    // notification settings. Without this the half of the file that is not
    // contacts is invisible from outside the zip, and neither the user nor the
    // on-device harness can tell a backup carrying their reminders from one that
    // silently does not.
    `, ${counts.otherRecords} other ${
      counts.otherRecords === 1 ? "record" : "records"
    } (${kb} KB).`
  );
}
