import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors } from "../lib/styles";

/** Empty, ticked, or mixed, which fills like ticked but wears a dash. */
export type CheckedState = boolean | "mixed";

/** The box alone, for a row that is itself the checkbox and carries the
 *  tap target and role. */
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
