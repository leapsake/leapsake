import type { ExportArchive } from "@leapsake/core";
import { describe, expect, it, vi } from "vitest";
import { saveExport } from "../src/main/export-file.js";

const archive: ExportArchive = {
  bytes: new Uint8Array([1, 2, 3]),
  filename: "leapsake-export-2026-10-22.zip",
  counts: { people: 2, pets: 1, contactMethods: 3, otherRecords: 4, bytes: 3 },
};

describe("saveExport", () => {
  it("offers the archive's own filename and writes its bytes where the user picks", async () => {
    const choosePath = vi.fn(async (name: string) => `/Users/george/${name}`);
    const write = vi.fn(async () => {});

    const counts = await saveExport({
      archive: async () => archive,
      choosePath,
      write,
    });

    expect(choosePath).toHaveBeenCalledWith("leapsake-export-2026-10-22.zip");
    expect(write).toHaveBeenCalledWith(
      "/Users/george/leapsake-export-2026-10-22.zip",
      archive.bytes,
    );
    expect(counts).toEqual(archive.counts);
  });

  it("writes nothing and reports nothing when the user cancels", async () => {
    const write = vi.fn(async () => {});

    const counts = await saveExport({
      archive: async () => archive,
      choosePath: async () => null,
      write,
    });

    expect(write).not.toHaveBeenCalled();
    expect(counts).toBeNull();
  });
});
