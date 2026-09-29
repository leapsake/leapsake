import { type ReactElement, useCallback, useEffect, useRef } from "react";
import { Pressable, Text } from "react-native";
import { showFormProblem } from "../lib/form-problem";
import { styles } from "../lib/styles";

interface SaveProps {
  /** Why the form isn't ready; Save stays pressable and says this. */
  problem?: string;
  saving: boolean;
  onPress: () => void;
}

/** A form's header Save, never disabled: it fades until ready, and a press
 *  says why. Back is the Cancel. */
export function HeaderSave({ problem, saving, onPress }: SaveProps) {
  const faded = saving || problem !== undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: saving }}
      onPress={() => {
        if (saving) return;
        if (problem === undefined) onPress();
        else showFormProblem(problem);
      }}
    >
      <Text style={[styles.link, faded && { opacity: 0.4 }]}>
        {saving ? "Saving…" : "Save"}
      </Text>
    </Pressable>
  );
}

/**
 * A `headerRight` that changes only when Save's look does. `onPress` goes
 * through a ref set in an effect, or it would save the form as first seen.
 */
export function useHeaderSave({
  problem,
  saving,
  onPress,
}: SaveProps): () => ReactElement {
  const latest = useRef(onPress);
  useEffect(() => {
    latest.current = onPress;
  });

  return useCallback(
    () => (
      <HeaderSave
        problem={problem}
        saving={saving}
        onPress={() => latest.current()}
      />
    ),
    [problem, saving],
  );
}
