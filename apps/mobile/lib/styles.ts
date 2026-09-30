import { StyleSheet } from "react-native";

// Warm surfaces and warm-grey lines; type and icons are the platform's own.
export const colors = {
  text: "#1a1a1a",
  muted: "#6b6b6b",
  /** Warm paper — the ground every screen is drawn on. */
  surface: "#fbf7f0",
  /** The tab bar and header: a shade deeper than {@link surface}. */
  surfaceRaised: "#f4ede1",
  /** Outlines that enclose something — an input, a container. */
  border: "#ded3c2",
  /** The hairline between list rows, lighter than {@link border}. */
  divider: "#eae1d3",
  accent: "#1f6feb",
  /** A wash of `accent` — the mention chip behind `@Name` in a composer. */
  accentTint: "rgba(31, 111, 235, 0.14)",
  danger: "#b00020",
  selectedBg: "#1f6feb",
  selectedText: "#ffffff",
  /** Behind a bottom sheet, dimming the screen it covers. */
  scrim: "rgba(0, 0, 0, 0.25)",
} as const;

/** Corner rounding. `sm` is a control, `lg` a surface over another. */
export const radius = {
  sm: 8,
  lg: 16,
} as const;

export const styles = StyleSheet.create({
  screen: {
    // Also a ScrollView `contentContainerStyle`, where `flex: 1` would clamp
    // the content to the viewport and silently stop it scrolling.
    flexGrow: 1,
    padding: 16,
    gap: 16,
    // The navigators paint the overscroll region too; this paints the content.
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.text,
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  /** A header action drawn as a bare glyph. No `color`: emoji ignore it. */
  headerGlyph: {
    fontSize: 20,
  },
  link: {
    fontSize: 16,
    color: colors.accent,
  },
  /** The chosen one, where a row of links is really a single-choice picker. */
  linkSelected: {
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  danger: {
    color: colors.danger,
  },
  muted: {
    color: colors.muted,
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  // A list row with a control beside its content. Composed with `row`.
  rowWithLead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  /** Centred against a row whose content may run to several lines. */
  rowChevron: {
    alignSelf: "center",
  },
  /** Takes the rest of the width, so long text wraps beside the control. */
  rowBody: {
    flex: 1,
  },
  rowText: {
    fontSize: 17,
    color: colors.text,
  },
  // Centred in a container that grows ({@link listContent}); in one that does
  // not, `flexGrow` still draws it at its own height rather than not at all.
  emptyState: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    paddingVertical: 24,
  },
  emptyStateMessage: {
    textAlign: "center",
  },
  /** Sized to its label, not the screen; `minWidth` makes two of them even. */
  emptyStateButton: {
    minWidth: 240,
    paddingHorizontal: 24,
  },
  /** Grows a list's content container so an empty state can centre in it. */
  listContent: {
    flexGrow: 1,
  },
  // A detail-screen section: a header (title + "Add" action) over a list.
  section: {
    gap: 8,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text,
  },
  /** A section you open, drawn as a button; composed over
   *  {@link buttonSecondary} and {@link buttonBlock}, adding only margin. */
  sectionButton: {
    marginTop: 12,
    marginBottom: 4,
  },
  // A list row's second line: a muted detail left, actions right.
  rowMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 4,
  },
  rowActions: {
    flexDirection: "row",
    gap: 16,
  },
  // A reminder's offers, one full-width button per line, in offer order.
  rowOffers: {
    gap: 12,
    marginTop: 4,
  },
  // A reminder detail's heading: weight marks it, at the field values' size,
  // since the nav bar already carries the large title.
  reminderHeading: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text,
  },
  // A prompt's occasion, muted, directly under the question it is about.
  promptOccasion: {
    fontSize: 15,
    color: colors.muted,
    marginTop: 2,
  },
  // The line explaining what ticking anything does, above the toggles.
  promptCaption: {
    fontSize: 15,
    color: colors.muted,
  },
  // The prompt's answer form: caption, toggles, Save.
  promptForm: {
    gap: 12,
  },
  // Detail "definition list": a label above its value.
  field: {
    gap: 2,
  },
  fieldLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  fieldValue: {
    fontSize: 17,
    color: colors.text,
  },
  // A record's timestamps on one line; wraps rather than clips when narrow.
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 12,
  },
  metaText: {
    fontSize: 11,
    color: colors.muted,
  },
  // Form input.
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 17,
    color: colors.text,
    // Lighter than its ground, so it reads as a well cut into the page.
    backgroundColor: "#ffffff",
  },
  // Two fields on one line. Bottom-aligned, so the inputs stay level when the
  // wider field's caption wraps.
  fieldPair: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
  },
  // For a pair where one half grows (a Typeahead's matches): top-aligned, so
  // the narrow half stays on the input's line.
  fieldPairTop: {
    alignItems: "flex-start",
  },
  // The two halves of a `fieldPair`, a third and two thirds of it.
  fieldPairNarrow: {
    flex: 1,
  },
  fieldPairWide: {
    flex: 2,
  },
  // A form inside another screen's scroll view: its gap, without its padding.
  inlineForm: {
    gap: 16,
  },

  // A field with a glyph at its head: the row wears `input`'s box, and the
  // input inside takes `input` minus the box, so height and type match.
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchGlyph: {
    fontSize: 17,
  },
  searchRowInput: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    // Android's `TextInput` carries its own default padding; without this the
    // text would sit lower than the glyph beside it.
    paddingVertical: 0,
  },
  // A password field with its Show/Hide toggle inside the box, as above.
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  passwordRowInput: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: "transparent",
    padding: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    minHeight: 0,
  },
  passwordToggle: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.accent,
  },

  // Bottom sheets
  // The row you tap to open a sheet, composed with `input`.
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chevron: {
    fontSize: 20,
    color: colors.muted,
  },
  // A value the field doesn't have yet, standing in the place it will occupy.
  fieldPlaceholder: {
    color: colors.muted,
  },
  // Dims the screen and, as the modal's flexible half, pins the sheet down.
  sheetBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
  },
  sheet: {
    backgroundColor: colors.surface,
    paddingBottom: 24,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    // Clips what slides under the rounded top corners.
    overflow: "hidden",
  },
  // The sheet's top bar: its way out, and where it says what it is.
  sheetBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text,
  },
  // A pressable rendered as a primary button.
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  /** The quieter button: {@link button}'s box, raised, with an accent label. */
  buttonSecondary: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonSecondaryText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: "600",
  },
  /** A {@link button} that destroys: red, with the same white label. */
  buttonDestructive: {
    backgroundColor: colors.danger,
  },
  /** A full-width button over {@link button} or {@link buttonSecondary};
   *  `minHeight`, not padding, so a wrapped label keeps the same height. */
  buttonBlock: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  /** Two peer buttons sharing a line, each with {@link buttonFill}. */
  buttonRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
  },
  buttonFill: {
    flex: 1,
  },
});
