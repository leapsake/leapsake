import { describe, expect, it } from "vitest";
import type { ExportArchive } from "@leapsake/core";
import {
  type ExportShareDeps,
  SharingUnavailable,
  exportAndShare,
  summarizeExport,
} from "./export-share";

const counts = (
  over: Partial<ExportArchive["counts"]> = {},
): ExportArchive["counts"] => ({
  people: 12,
  pets: 2,
  contactMethods: 30,
  otherRecords: 11,
  bytes: 8_192,
  ...over,
});

const archive = (
  over: Partial<ExportArchive["counts"]> = {},
): ExportArchive => ({
  bytes: new Uint8Array([1, 2, 3]),
  filename: "leapsake-export-2026-09-08.zip",
  counts: counts(over),
});

/** A device that shares, with a written file whose deletion is observable. */
function deps(over: Partial<ExportShareDeps> = {}) {
  const removed: string[] = [];
  const shared: string[] = [];
  const written: Array<[string, Uint8Array]> = [];
  const base: ExportShareDeps = {
    archive: () => Promise.resolve(archive()),
    write: (filename, bytes) => {
      written.push([filename, bytes]);
      return {
        uri: `file:///Caches/${filename}`,
        remove: () => removed.push(filename),
      };
    },
    canShare: () => Promise.resolve(true),
    share: (uri) => {
      shared.push(uri);
      return Promise.resolve();
    },
  };
  return { deps: { ...base, ...over }, removed, shared, written };
}

describe("exportAndShare", () => {
  it("writes the archive under its own name and shares that file", async () => {
    const { deps: d, shared, written } = deps();

    const line = await exportAndShare(d);

    expect(written).toEqual([
      ["leapsake-export-2026-09-08.zip", new Uint8Array([1, 2, 3])],
    ]);
    expect(shared).toEqual(["file:///Caches/leapsake-export-2026-09-08.zip"]);
    expect(line).toBe(summarizeExport(counts()));
  });

  it("deletes the file after a successful share", async () => {
    const { deps: d, removed } = deps();

    await exportAndShare(d);

    expect(removed).toEqual(["leapsake-export-2026-09-08.zip"]);
  });

  // The whole reason the delete sits in a `finally`: a plaintext dump of
  // somebody's address book must not survive a failed share.
  it("deletes the file when sharing throws", async () => {
    const { deps: d, removed } = deps({
      share: () => Promise.reject(new Error("share sheet fell over")),
    });

    await expect(exportAndShare(d)).rejects.toThrow("share sheet fell over");
    expect(removed).toEqual(["leapsake-export-2026-09-08.zip"]);
  });

  it("refuses, and still deletes, when the device cannot share", async () => {
    const {
      deps: d,
      removed,
      shared,
    } = deps({
      canShare: () => Promise.resolve(false),
    });

    await expect(exportAndShare(d)).rejects.toBeInstanceOf(SharingUnavailable);
    expect(shared).toEqual([]);
    expect(removed).toEqual(["leapsake-export-2026-09-08.zip"]);
  });

  // A failure before there is a file is a failure with nothing to clean up.
  it("never writes when the archive itself fails", async () => {
    const {
      deps: d,
      written,
      removed,
    } = deps({
      archive: () => Promise.reject(new Error("no store")),
    });

    await expect(exportAndShare(d)).rejects.toThrow("no store");
    expect(written).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("survives a file it cannot delete", async () => {
    const { deps: d } = deps({
      write: (filename) => ({
        uri: `file:///Caches/${filename}`,
        remove: () => {
          throw new Error("gone already");
        },
      }),
    });

    await expect(exportAndShare(d)).resolves.toBe(summarizeExport(counts()));
  });
});

describe("summarizeExport", () => {
  it("counts every part of the archive, plural", () => {
    expect(summarizeExport(counts())).toBe(
      "Exported 12 people, 2 pets, 30 contact methods, 11 other records (8 KB).",
    );
  });

  it("says each of them in the singular when there is one", () => {
    expect(
      summarizeExport(
        counts({ people: 1, pets: 1, contactMethods: 1, otherRecords: 1 }),
      ),
    ).toBe(
      "Exported 1 person, 1 pet, 1 contact method, 1 other record (8 KB).",
    );
  });

  it("says zero rather than omitting a part", () => {
    expect(
      summarizeExport(
        counts({ people: 0, pets: 0, contactMethods: 0, otherRecords: 0 }),
      ),
    ).toBe(
      "Exported 0 people, 0 pets, 0 contact methods, 0 other records (8 KB).",
    );
  });

  // `otherRecords` is the only evidence outside the zip that the half of the
  // archive which is not contacts travelled at all — `data.json`'s whole point.
  it("reports the non-contact half of the archive", () => {
    expect(summarizeExport(counts({ otherRecords: 47 }))).toContain(
      "47 other records",
    );
  });

  // A small store rounds to zero, and "0 KB" reads as a file that is not there.
  it("never reports 0 KB", () => {
    expect(summarizeExport(counts({ bytes: 12 }))).toContain("(1 KB)");
    expect(summarizeExport(counts({ bytes: 0 }))).toContain("(1 KB)");
  });
});
