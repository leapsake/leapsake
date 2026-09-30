import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { ActionSheet, type SheetItem } from "./ActionSheet";
import { styles } from "../lib/styles";

const MORE = "⋯";
const moreActionsFor = (subject: string) => `More actions for ${subject}`;

/** A row's trailing `⋯`, which opens its actions in an {@link ActionSheet}. */
export function RowMenu({
  subject,
  title = subject,
  items,
}: {
  /** What the row is, for the button's accessibility label. */
  subject: string;
  /** The sheet's heading, when it should say more than {@link subject}. */
  title?: string;
  items: readonly SheetItem[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={moreActionsFor(subject)}
        onPress={() => setOpen(true)}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 12 }}
        style={local.button}
      >
        <Text style={styles.link}>{MORE}</Text>
      </Pressable>
      <ActionSheet
        visible={open}
        title={title}
        items={items}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** The sheet options every row shares, so each reads the same everywhere. */
export const rowMenuItem = {
  edit: (onPress: () => void): SheetItem => ({
    key: "edit",
    glyph: "✏️",
    label: "Edit",
    onPress,
  }),
  details: (onPress: () => void): SheetItem => ({
    key: "details",
    glyph: "ℹ️",
    label: "Details",
    onPress,
  }),
  reminders: (onPress: () => void): SheetItem => ({
    key: "reminders",
    glyph: "🔔",
    label: "Reminders",
    onPress,
  }),
  remove: (onPress: () => void): SheetItem => ({
    key: "remove",
    glyph: "🗑️",
    label: "Remove",
    danger: true,
    onPress,
  }),
};

const local = StyleSheet.create({
  /** Sized to a tap, not to the glyph. */
  button: {
    minWidth: 32,
    paddingVertical: 2,
    alignItems: "center",
  },
});
