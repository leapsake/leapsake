import { StyleSheet } from "react-native";

// A small shared stylesheet for visual consistency across the People screens.
// Deliberately minimal — the desktop UI is plain too; a design pass comes later.
export const colors = {
  text: "#1a1a1a",
  muted: "#6b6b6b",
  border: "#d4d4d4",
  accent: "#1f6feb",
  danger: "#b00020",
  selectedBg: "#1f6feb",
  selectedText: "#ffffff",
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
    gap: 16,
  },
  link: {
    fontSize: 16,
    color: colors.accent,
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
    borderBottomColor: colors.border,
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
  // A list row's offers — what it invites you to do, below its meta row. Wraps,
  // because three of them don't fit one narrow-phone line.
  rowOffers: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 16,
    marginTop: 4,
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
  // Form input.
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 17,
    color: colors.text,
  },
  // A form embedded in another screen's scroll view (a staged milestone or
  // contact method on the create screen): the `screen` gap without its padding,
  // which the host screen has already applied.
  inlineForm: {
    gap: 16,
  },
  // A pressable rendered as a primary button.
  button: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
