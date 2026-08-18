/**
 * The **New** tab's route, which is never rendered.
 *
 * New is a verb, not a destination: `app/(tabs)/_layout.tsx` calls
 * `preventDefault()` on its press, so navigation to this route never happens and
 * this component never mounts. The file exists because expo-router builds the
 * tab bar from the files in this directory — a tab with no route is not a tab.
 *
 * Not rendering is also what keeps the tab from ever showing a selected state:
 * the press is cancelled, so the tab never becomes focused, so the active tint
 * never reaches it. There is no styling anywhere that has to remember to
 * suppress it.
 */
export default function NewTabRoute() {
  return null;
}
