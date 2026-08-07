import {
  Pressable,
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
 * A checkbox: the box and its tap target. The caller owns the state and whatever
 * write flipping it performs, so this stays usable both for a screen holding
 * selection in memory (the contacts import's select-all) and for one whose
 * "state" is a row in the database (a reminder's completion).
 *
 * The box is 24pt, under the 44pt touch-target guidance, so `hitSlop` makes up
 * the difference here rather than at each call site.
 *
 * Where the *whole row* is the toggle, use {@link CheckboxBox} inside that row's
 * own pressable instead — a pressable nested in a pressable would claim the
 * checkbox role twice and leave a screen reader with two controls for one write.
 */
export function Checkbox({
  checked,
  onPress,
  accessibilityLabel,
  disabled = false,
  style,
}: {
  checked: CheckedState;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  /** Caller-side nudges — alignment against neighbouring text, dimming. */
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={style}
    >
      <CheckboxBox checked={checked} />
    </Pressable>
  );
}

/** The box alone, with no tap target or accessibility role of its own — for a
 *  row that is itself the checkbox and carries both. */
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
