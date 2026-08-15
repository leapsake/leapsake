/**
 * Design tokens — plain data, deliberately.
 *
 * No CSS, no `StyleSheet`, no framework: a token file that is just objects is
 * the one layer a React Native renderer could consume unchanged if
 * `@leapsake/ui/native` ever exists. Emitting CSS variables here would close
 * that door for no present gain.
 *
 * **This is a seed, not a design system.** The values are lifted from
 * `apps/mobile/lib/styles.ts`, which is the only place in the repo that ever
 * committed to a palette; desktop is unstyled semantic HTML. Nothing consumes
 * these yet. The real visual pass is a separate pre-v0.1 increment, and it is
 * expected to replace most of these numbers.
 */

export const color = {
  text: "#1a1a1a",
  muted: "#6b6b6b",
  border: "#d4d4d4",
  accent: "#1f6feb",
  /** A wash of {@link accent} — the mention chip behind `@Name` in a composer. */
  accentTint: "rgba(31, 111, 235, 0.14)",
  danger: "#b00020",
  selectedBg: "#1f6feb",
  selectedText: "#ffffff",
  surface: "#ffffff",
} as const;

/** Spacing scale in px. Mobile's screens are built on 4/8/12/16. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

/** Font sizes in px, named by role rather than by size. */
export const fontSize = {
  detail: 13,
  body: 17,
  sectionTitle: 17,
  title: 24,
} as const;

export const fontWeight = {
  regular: "400",
  semibold: "600",
  bold: "700",
} as const;
