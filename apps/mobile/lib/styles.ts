import { StyleSheet } from "react-native";

// A small shared stylesheet for visual consistency across the app's screens.
//
// The **surfaces** are warm rather than white, and the lines drawn on them are
// warm greys rather than neutral ones. That is the whole of the visual pass so
// far, deliberately: type and icons are untouched (still the platform font, still
// emoji), because changing structure and appearance in one go makes a regression
// indistinguishable from a redesign. Colour and shape are the half that can move
// without touching a single layout.
export const colors = {
  text: "#1a1a1a",
  muted: "#6b6b6b",
  /** Warm paper — the ground every screen is drawn on. */
  surface: "#fbf7f0",
  /**
   * The chrome that frames the page: the tab bar and the header. A shade deeper
   * than {@link surface}, which is what separates them from the content without
   * spending a hard rule on it.
   */
  surfaceRaised: "#f4ede1",
  /** Outlines that enclose something — an input, a container. */
  border: "#ded3c2",
  /**
   * Separators *between* things — the hairline under a list row. Lighter than
   * {@link border}: a divider that matches the weight of an input's outline
   * turns a list into a stack of boxes.
   */
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

/** Corner rounding. `sm` is a control, `lg` is a surface that sits over another. */
export const radius = {
  sm: 8,
  lg: 16,
} as const;

export const styles = StyleSheet.create({
  screen: {
    // `flexGrow`, not `flex: 1`: this style is used both as a plain View root
    // (fills the screen) and as a ScrollView `contentContainerStyle`. On a
    // scroll content container `flex: 1` clamps the content to the viewport
    // height, which silently disables scrolling and hides anything below the
    // fold (e.g. the factory-reset button). `flexGrow` fills when short but
    // still lets tall content grow and scroll.
    flexGrow: 1,
    padding: 16,
    gap: 16,
    // Painted here as well as on the navigators' own scene backgrounds
    // (app/_layout.tsx, app/(tabs)/_layout.tsx). Both are needed: the navigator
    // covers the overscroll region a ScrollView bounces into, this covers the
    // content itself.
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
  /**
   * A header action drawn as a bare glyph — the 🔍 and ➕ a catalog carries
   * (`components/SearchHereLink.tsx`, `components/NewLink.tsx`).
   *
   * Smaller than the title it sits beside and larger than a {@link link}: it has
   * to read as a control at a glance without competing with the screen's name,
   * and an emoji fills more of its box than letters fill theirs. It does **not**
   * take `colors.accent` — an emoji ignores `color` on both platforms, so the
   * tint would be a lie in the stylesheet that the screen never shows.
   */
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
  // A list row led by a control (a checkbox) with its content beside it. Composed
  // with `row`, which keeps the padding and the separator. The gap is shared so
  // every such list indents its text to the same place.
  rowWithLead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  /** Sit the leading control on the first line of the text beside it. */
  rowLeadCheckbox: {
    marginTop: 2,
  },
  /** Everything to the right of a leading control — takes the rest of the width
   *  so long text wraps beside the control rather than under it. */
  rowBody: {
    flex: 1,
  },
  rowText: {
    fontSize: 17,
    color: colors.text,
  },
  // An empty list's message over the offers that fill it (see `EmptyState`).
  // Padded off the top of the list so it doesn't sit flush under the header.
  emptyState: {
    paddingTop: 8,
    gap: 12,
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
  // The second line of a list row: a muted detail on the left, actions on the right.
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
  // A reminder's offers — what it invites you to do, below the standing actions
  // on its detail screen. Wraps, because three of them don't fit one
  // narrow-phone line.
  rowOffers: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 16,
    marginTop: 4,
  },
  // A reminder detail's heading: its title, or its body when it has no title —
  // whichever the list would have shown — carrying the completion checkbox
  // beside it. Weight rather than a "Title" label marks it as the heading, so the
  // thing the screen is about reads as a heading instead of as the first row of a
  // definition list. Same size as the field values below it: the nav bar already
  // carries the screen's large title, and a second 24pt one would shout.
  reminderHeading: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text,
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
  // A record's bookkeeping footer (see `RecordTimestamps`): both timestamps on
  // one line, small and muted. Wraps instead of clipping, so the narrowest
  // phones get two short lines rather than a truncated date.
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
    // An input is a place to put something *into*, so it reads as a well cut
    // into the page rather than a card lying on it. On warm paper that only
    // works if it is lighter than its ground.
    backgroundColor: "#ffffff",
  },
  // Two form fields sharing one line, where one of them is short enough to give
  // the width away: a contact method's Label ("Mobile") beside the address or
  // number it names. The widths are proportional rather than fixed so the pair
  // still holds on the narrowest phone. Bottom-aligned, not top-: that keeps the
  // two inputs on one line even when the wider field's caption wraps — the
  // captions go ragged instead, which is much the lesser of the two.
  fieldPair: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
  },
  // Overrides the above where one half of the pair *grows* — a Typeahead listing
  // its matches under the field. Bottom-aligning there would carry the narrow
  // half down the page beside the list instead of leaving it on the input's line.
  fieldPairTop: {
    alignItems: "flex-start",
  },
  // The two halves of a `fieldPair`, a third and two thirds of it. Which field
  // takes which is the caller's call — the Label is the narrow one beside an
  // email address, and so is State beside City.
  fieldPairNarrow: {
    flex: 1,
  },
  fieldPairWide: {
    flex: 2,
  },
  // A form embedded in another screen's scroll view (a staged milestone or
  // contact method on the create screen): the `screen` gap without its padding,
  // which the host screen has already applied.
  inlineForm: {
    gap: 16,
  },

  // --- A field with a glyph at its head ------------------------------------
  // The 🔍 field, in both places one appears: the Search tab and the filter
  // inside a `SuggestField`'s sheet. The glyph is a **sibling** of the input
  // rather than part of its text — it has to outlive the placeholder, and a
  // value read back to a user must never begin with an emoji — so the box moves
  // out to a row that wears it and the `TextInput` keeps everything else.
  //
  // Composed from `input` rather than copied out of it, at both levels: the row
  // wears the box (its inherited padding is what sets the height, so the field
  // is exactly as tall as a plain one), and the input inside takes the same
  // style back minus the box, which is what keeps the type identical.
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

  // --- Bottom sheets -------------------------------------------------------
  // A field whose value is chosen somewhere else — the row you tap to open the
  // sheet, wearing the input's own outline so a form reads as one column of
  // controls whether or not you can type into them (see `SelectField`,
  // `SuggestField`). Composed with `input`.
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
  // Everything above the sheet: dims the screen and, being the flexible half of
  // the modal, is also what pins the sheet to the bottom of it.
  sheetBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
  },
  sheet: {
    backgroundColor: colors.surface,
    paddingBottom: 24,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    // The rounded top corners only read as rounded if what slides under them is
    // clipped to the same shape.
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
});
