import { Pressable, Text } from "react-native";
import { styles } from "../lib/styles";

/**
 * The **Save** action that every entity form now carries in its native header,
 * where the tab screens put "+ Add" — replacing the in-body Cancel/Add row the
 * forms used to render. There is no Cancel beside it: the stack's own "‹ Back"
 * already leaves without saving, and a second way to do the same thing was
 * competing with the one the platform draws for free.
 *
 * Rendered from a screen's `Stack.Screen options.headerRight`. It stays mounted
 * while disabled rather than disappearing, so the action's place on screen never
 * moves as the form becomes valid.
 */
export function HeaderSave({
  canSave,
  saving,
  onPress,
}: {
  canSave: boolean;
  saving: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !canSave || saving }}
      disabled={!canSave || saving}
      onPress={onPress}
    >
      <Text style={[styles.link, (!canSave || saving) && { opacity: 0.4 }]}>
        {saving ? "Saving…" : "Save"}
      </Text>
    </Pressable>
  );
}
