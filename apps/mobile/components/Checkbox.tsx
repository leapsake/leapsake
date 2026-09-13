import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors } from "../lib/styles";

/** Whether a box is empty, ticked, or — the tri-state some-but-not-all case —
 *  mixed. A mixed box fills like a ticked one, because *something* is selected,
 *  but wears a dash instead of a tick. */
export type CheckedState = boolean | "mixed";

/**
 * The box alone, with no tap target or accessibility role of its own — for a row
 * that is itself the checkbox and carries both.
 *
 * There is deliberately no standalone checkbox *control* beside this. There was
 * one, and it had exactly two callers: a select-all on an import checklist that
 * no longer exists, and a reminder's completion, which is a button among that
 * reminder's other offers now (`app/reminders/[id]/index.tsx`). A tick that
 * stands on its own turns out to be the wrong shape for this app twice over —
 * it is a small target on screens whose every other control is full width, and
 * it renders a decision as a property. Where a whole row toggles, the row wears
 * the role and this draws the box.
 */
export function CheckboxBox({
  checked,
  style,
}: {
  checked: CheckedState;
  style?: StyleProp<ViewStyle>;
}) {
  const on = checked !== false;
  return (
    <View style={[styles.box, on && styles.boxOn, style]}>
      {on && <Text style={styles.mark}>{checked === true ? "✓" : "–"}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  mark: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
});
