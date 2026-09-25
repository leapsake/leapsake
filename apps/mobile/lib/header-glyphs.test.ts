import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { TAB_SCREENS } from "./tab-screens";

const MOBILE = join(import.meta.dirname, "..");
const TABS = join(MOBILE, "app", "(tabs)");

const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => join(dir, file));

const importsGlyph = (source: string) =>
  /import\s*\{[^}]*\b(NewLink|SearchHereLink)\b[^}]*\}\s*from/.test(source);

describe("the header's 🔍 and ➕", () => {
  // AppHeader's single row holds Back or the glyphs, never both; only the tab navigator grants no Back.
  it("are declared only by the tab navigator, which never shows Back", () => {
    const declaring = [
      ...sourcesUnder(join(MOBILE, "app")),
      ...sourcesUnder(join(MOBILE, "components")),
    ]
      .filter((file) => importsGlyph(readFileSync(file, "utf8")))
      .map((file) => relative(MOBILE, file));
    expect(declaring).toEqual([join("app", "(tabs)", "_layout.tsx")]);
  });
});

describe("the tab navigator", () => {
  // expo-router gives any undeclared file in (tabs) a bar button of its own.
  it("hosts exactly the table's screens, catalogs included", () => {
    const routes = readdirSync(TABS)
      .filter((file) => file !== "_layout.tsx")
      .map((file) => file.replace(/\.tsx$/, ""))
      .sort();
    expect(routes).toEqual(TAB_SCREENS.map((s) => s.name).sort());
  });
});
