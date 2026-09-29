// Design tokens as plain data, seeded from mobile's palette.

export const color = {
  text: "#1a1a1a",
  muted: "#6b6b6b",
  /** Warm paper — the ground a screen is drawn on. */
  surface: "#fbf7f0",
  /** Chrome that frames the page, such as the tab bar: a shade deeper. */
  surfaceRaised: "#f4ede1",
  /** Outlines that enclose something — an input, a container. */
  border: "#ded3c2",
  /** Separators *between* things: lighter than {@link border}. */
  divider: "#eae1d3",
  accent: "#1f6feb",
  /** A wash of {@link accent}: the chip behind `@Name` in a composer. */
  accentTint: "rgba(31, 111, 235, 0.14)",
  danger: "#b00020",
  selectedBg: "#1f6feb",
  selectedText: "#ffffff",
  /** Behind a sheet or dialog, dimming what it covers. */
  scrim: "rgba(0, 0, 0, 0.25)",
} as const;

/** Corner rounding in px: `sm` a control, `lg` a surface over a surface. */
export const radius = {
  sm: 8,
  lg: 16,
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
