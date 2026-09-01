import { type ReactElement, useCallback, useEffect, useRef } from "react";
import { Pressable, Text } from "react-native";
import { styles } from "../lib/styles";

/**
 * The **Save** action that every entity form now carries in its header, replacing
 * the in-body Cancel/Add row the forms used to render. It shares the corner's
 * *position* with the list screens' ➕ ({@link NewLink}) but never the screen:
 * a ➕ starts a create and Save ends one, so a form is always somewhere the ➕
 * has already been tapped. There is no Cancel beside it either — the stack's own
 * "‹ Back" already leaves without saving, and a second way to do the same thing
 * was competing with the one the platform draws for free.
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

/**
 * {@link HeaderSave} as a **stable** `headerRight` — the form's own re-rendering
 * kept off the navigator's.
 *
 * `Stack.Screen` re-applies its options whenever the object it is handed changes
 * identity, and an inline `headerRight` arrow is a new function on every render.
 * A form that re-renders per keystroke was therefore re-rendering the native
 * header per keystroke too, which is work in a part of the screen that cannot
 * have changed: the button only ever looks two ways. This gives back a callback
 * that changes when its *appearance* does — when the form becomes valid, or the
 * save starts — and not before.
 *
 * `onPress` is read through a ref rather than closed over, and that indirection
 * is the whole reason this is a hook rather than a `useCallback` at each call
 * site. A form's save closes over everything typed into it, so a `headerRight`
 * memoized on `canSave` alone would keep calling the save from the render where
 * validity last flipped — writing the form as it stood several keystrokes ago.
 * The ref is set in an effect rather than during render so that a render which
 * never commits cannot arm a save with itself.
 */
export function useHeaderSave({
  canSave,
  saving,
  onPress,
}: {
  canSave: boolean;
  saving: boolean;
  onPress: () => void;
}): () => ReactElement {
  const latest = useRef(onPress);
  useEffect(() => {
    latest.current = onPress;
  });

  return useCallback(
    () => (
      <HeaderSave
        canSave={canSave}
        saving={saving}
        onPress={() => latest.current()}
      />
    ),
    [canSave, saving],
  );
}
