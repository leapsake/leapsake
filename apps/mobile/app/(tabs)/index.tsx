import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  type ReminderWithTags,
  formatDueIn,
  reminderLabel,
} from "@leapsake/schema";
import { partitionReminders } from "@leapsake/view-models";
import { Checkbox } from "../../components/Checkbox";
import { ReminderText } from "../../components/ReminderText";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";

/**
 * The Reminders tab — the app's home/landing screen, so it lives at the `(tabs)`
 * group's `index` route. A standalone list of user-created reminders: open ones
 * lead; completed ones sink to the bottom with a struck-through label. Each row
 * toggles completion in place (the list reloads without navigating); every *other*
 * action a reminder offers lives on its detail screen, which the row text taps
 * through to. "+ Add" lives on the tab header (app/(tabs)/_layout.tsx).
 *
 * That split is why this screen reads nothing but the list. The gift targets and
 * the duplicates-nudge id it used to fetch existed only to decide which offers a
 * row rendered; the screen that renders them now fetches them instead.
 *
 * Snoozed reminders show nowhere. `partitionReminders` hands back a third bucket
 * and this screen deliberately ignores it: a surface for it would hand the user a
 * way to *complete* a snoozed row, which reopens the still-open question of
 * whether reopening should clear a running clock (`plans/onboarding.md` §7).
 */
export default function RemindersScreen() {
  const core = useCore();
  const load = useCallback(() => core.reminders.list(), [core]);
  const { data: reminders, error, reload } = useFocusedData(load);

  if (error !== null) {
    return (
      <View style={styles.screen}>
        <Text style={styles.danger}>{error}</Text>
      </View>
    );
  }
  if (reminders === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  // Open first, then completed — one flat list for the FlatList.
  const { open, done } = partitionReminders(reminders);
  const ordered = [...open, ...done];

  return (
    <View style={styles.screen}>
      <FlatList
        data={ordered}
        keyExtractor={(r) => r.id}
        ListEmptyComponent={<Text style={styles.muted}>No reminders yet.</Text>}
        renderItem={({ item }) => (
          <ReminderRow reminder={item} reload={reload} />
        )}
      />
    </View>
  );
}

/**
 * One reminder row: a completion checkbox on the leading edge, beside its heading
 * (and body, when it has both) over its due-in.
 *
 * The checkbox is the row's only write. Everything else a reminder can offer — a
 * nudge's *do it* / *not now* / *don't ask again*, a gift row's link to the
 * recipient, and deletion — is one tap away on the detail screen rather than
 * spread across a list row, so a row can't destroy anything and the list stays
 * scannable. Tapping anywhere else on the row goes there, and the reminder is now
 * the *only* place a tap can land: a nudge used to deep-link straight to the step
 * it asked for (which would strand its put-off and dismiss on a screen the user
 * could no longer reach), and a `#tag` or `@mention` used to be its own link.
 */
function ReminderRow({
  reminder,
  reload,
}: {
  reminder: ReminderWithTags;
  reload: () => Promise<void>;
}) {
  const core = useCore();
  const router = useRouter();
  const done = reminder.completedAt !== null;
  const strike = done
    ? { textDecorationLine: "line-through" as const, color: colors.muted }
    : undefined;
  // Title leads; the body shows underneath as details. With no title the body
  // *is* the heading, so it isn't repeated below.
  const heading = reminder.title ?? reminder.body ?? "";
  // How this reminder is named, for the checkbox's accessibility label — nothing
  // else here names it now that the row's own buttons are gone.
  const label = reminderLabel(reminder);
  const open = () => router.push(`/reminders/${reminder.id}`);

  function toggle() {
    core.reminders.setCompleted(reminder.id, !done).then(
      () => reload(),
      (e: unknown) => Alert.alert("Couldn’t update", String(e)),
    );
  }

  return (
    <View style={[styles.row, styles.rowWithLead]}>
      {/* The completion toggle — deliberately a sibling of the link below rather
          than inside it, so tapping through to the reminder never flips it, and
          so a screen reader gets two controls rather than one ambiguous one. */}
      <Checkbox
        accessibilityLabel={done ? `Reopen “${label}”` : `Mark “${label}” done`}
        checked={done}
        onPress={toggle}
        style={styles.rowLeadCheckbox}
      />
      {/* Everything but the checkbox is one link to the reminder — the text, the
          due-in, and the empty space beside them. A phone has no room for a row
          that is several small targets, so the row is one big one, and the tags
          and mentions inside it are highlighted but not separately tappable
          (`linkAnnotations`): on a detail screen they lead to their own pages,
          but here they would be millimetre-wide traps inside the region the user
          is aiming at. `accessible` groups the children so a screen reader
          announces the row as the single link it now is. */}
      <Pressable
        accessible
        accessibilityRole="link"
        onPress={open}
        style={styles.rowBody}
      >
        <ReminderText
          text={heading}
          tags={reminder.tags}
          mentions={reminder.mentions}
          style={[styles.rowText, strike]}
          linkAnnotations={false}
        />
        {reminder.title !== null && reminder.body !== null && (
          <ReminderText
            text={reminder.body}
            tags={reminder.tags}
            mentions={reminder.mentions}
            style={[styles.muted, strike]}
            linkAnnotations={false}
          />
        )}
        {reminder.dueDate !== null && (
          <View style={styles.rowMeta}>
            <Text style={styles.muted}>{formatDueIn(reminder.dueDate)}</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}
