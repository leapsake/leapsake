import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { RowMenu, rowMenuItem } from "./RowMenu";
import { styles } from "../lib/styles";

/**
 * An open row on a form, not yet saved: a small label saying which one it is,
 * a ⋯ holding Remove, and its fields below.
 */
export function DraftRow({
  label,
  subject,
  onRemove,
  children,
}: {
  /** Drawn as the row's label; may hold glyphs and a date. */
  label: ReactNode;
  /** The label as plain words, for the ⋯'s accessibility label. */
  subject: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <View style={[styles.row, styles.inlineForm]}>
      <View style={styles.sectionHeader}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <RowMenu subject={subject} items={[rowMenuItem.remove(onRemove)]} />
      </View>
      {children}
    </View>
  );
}
