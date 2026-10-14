import { describe, expect, it } from "vitest";
import { TAG_COLORS, tagColor } from "./tag-color";

// `colors.surface`, `colors.surfaceRaised` and an input's white, from
// `./styles`, which imports React Native and so cannot load here.
const GROUNDS = ["#fbf7f0", "#f4ede1", "#ffffff"];

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

/** WCAG 2 relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hue(hex: string): number {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h =
    max === r
      ? ((g - b) / d) % 6
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe("tag colours", () => {
  it("are each readable as body text on every surface a tag sits on", () => {
    for (const color of TAG_COLORS) {
      for (const ground of GROUNDS) {
        expect(contrast(color, ground)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("are none of them blue, which belongs to mentions and links", () => {
    for (const color of TAG_COLORS) {
      const h = hue(color);
      expect(h < 180 || h > 265).toBe(true);
    }
  });

  it("give a tag the same colour however it is spelled", () => {
    expect(tagColor("#Family")).toBe(tagColor("family"));
    expect(tagColor(" FAMILY ")).toBe(tagColor("family"));
  });

  it("spread different tags across the palette", () => {
    const names = ["family", "work", "birthday", "party", "flowers", "letter"];
    expect(new Set(names.map(tagColor)).size).toBeGreaterThan(1);
  });
});
