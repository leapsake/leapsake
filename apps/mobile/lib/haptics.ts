import * as Haptics from "expo-haptics";

/** Felt cues for what just happened. Each fires and forgets, and a device
 *  without haptics, or with them switched off, stays silent. */
export const haptic = {
  /** Something was finished, such as a reminder marked done. */
  done: () =>
    quietly(() =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    ),
  /** A checkbox or radio changed. */
  ticked: () => quietly(() => Haptics.selectionAsync()),
};

function quietly(cue: () => Promise<void>): void {
  try {
    cue().catch(() => {});
  } catch {
    // A cue that cannot play is not worth failing the action it marks.
  }
}
