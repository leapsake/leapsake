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
import type { GiftReminderTarget } from "@leapsake/core";
import {
  type ReminderWithTags,
  formatDueIn,
  reminderLabel,
} from "@leapsake/schema";
import { partitionReminders, reminderActionsOf } from "@leapsake/view-models";
import { Checkbox } from "../../components/Checkbox";
import { ReminderText } from "../../components/ReminderText";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import {
  offerFor,
  removalCopyFor,
  showsRemove,
  tapPathFor,
} from "../../lib/reminder-row";
import { colors, styles } from "../../lib/styles";

/** The title on the alert a failed write raises. Each says which write failed,
 *  since the row offers several and a bare "Something went wrong" wouldn't. */
const FAILURE_TITLES = {
  complete: "Couldn’t update",
  snooze: "Couldn’t put this off",
  remove: "Couldn’t delete",
} as const;

/**
 * The Reminders tab — the app's home/landing screen, so it lives at the `(tabs)`
 * group's `index` route. A standalone list of user-created reminders: open ones
 * lead; completed ones sink to the bottom with a struck-through label. Each row
 * toggles completion and acts in place (the list reloads without navigating).
 * "+ Add" lives on the tab header (app/(tabs)/_layout.tsx).
 *
 * Snoozed reminders show nowhere. `partitionReminders` hands back a third bucket
 * and this screen deliberately ignores it: a surface for it would hand the user a
 * way to *complete* a snoozed row, which reopens the still-open question of
 * whether reopening should clear a running clock (`plans/onboarding.md` §7).
 */
export default function RemindersScreen() {
  const core = useCore();
  // The rows plus which of them are `🎁 gift` reminders and who they're about, so
  // a gift reminder can offer the recipient's gifts (and, once done, logging one).
  const load = useCallback(
    () =>
      Promise.all([
        core.reminders.list(),
        core.reminders.giftTargets(),
        // The duplicates nudge is content-addressed on the outstanding pair set,
        // so unlike the onboarding nudges its id can't come from a static table —
        // core recomputes it from the live pairs and the list matches on it.
        core.duplicates.nudgeId(),
      ]),
    [core],
  );
  const { data, error, reload } = useFocusedData(load);

  if (error !== null) {
    return (
      <View style={styles.screen}>
        <Text style={styles.danger}>{error}</Text>
      </View>
    );
  }
  if (data === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  const [reminders, giftTargets, duplicatesNudgeId] = data;
  const giftTargetById = new Map(giftTargets.map((t) => [t.reminderId, t]));
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
          <ReminderRow
            reminder={item}
            giftTarget={giftTargetById.get(item.id)}
            isDuplicatesNudge={item.id === duplicatesNudgeId}
            reload={reload}
          />
        )}
      />
    </View>
  );
}

/**
 * One reminder row: a completion checkbox on the leading edge, beside its heading
 * (and body, when it has both) over a meta row of due-in and Remove, with whatever
 * the row offers — do it · not now · don't ask again — on a line of its own
 * beneath.
 */
function ReminderRow({
  reminder,
  giftTarget,
  isDuplicatesNudge = false,
  reload,
}: {
  reminder: ReminderWithTags;
  /** Set when this is a `🎁 gift` reminder — who it's about. */
  giftTarget?: GiftReminderTarget;
  /** Set when this row is the duplicates nudge, which opens the review. */
  isDuplicatesNudge?: boolean;
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
  // How this reminder is *named* — in the checkbox's accessibility label and in
  // the removal confirmation alike, so both call it the same thing.
  const label = reminderLabel(reminder);
  // Everything this row offers, in offer order — the view-model is the only
  // authority on *what* is offered; this screen owns only how it looks. An
  // ordinary reminder (milestone / birthday / user) offers nothing.
  const actions = reminderActionsOf(reminder, {
    giftTarget,
    isDuplicatesNudge,
  });
  // The row text's own destination, which isn't always the CTA's — see
  // `tapPathFor`. Derived back out of the offers rather than asking
  // `reminderCtaOf` a second time.
  const cta = actions.find((a) => a.kind === "cta")?.cta ?? null;
  const open = () => router.push(tapPathFor(cta, reminder.id));
  const removal = removalCopyFor(actions);

  function toggle() {
    core.reminders.setCompleted(reminder.id, !done).then(
      () => reload(),
      (e: unknown) => Alert.alert(FAILURE_TITLES.complete, String(e)),
    );
  }

  /** Put this row off until the date its offered action carried — handed
   *  straight through, so nothing here re-derives a schedule. `snooze` spends the
   *  repetition itself, so there is no count to send. */
  function snooze(until: number) {
    core.reminders.snooze(reminder.id, until).then(
      () => reload(),
      (e: unknown) => Alert.alert(FAILURE_TITLES.snooze, String(e)),
    );
  }

  /**
   * The permanent out, reached from `Remove` and from a nudge's "don't ask
   * again" alike — one write, worded for whichever row it was handed. Removing a
   * nudge has always been permanent; only its presentation lied.
   */
  function confirmDelete() {
    Alert.alert(removal.title, removal.message(label), [
      { text: "Cancel", style: "cancel" },
      {
        text: removal.confirm,
        style: "destructive",
        onPress: () =>
          core.reminders.softDelete(reminder.id).then(
            () => reload(),
            (e: unknown) => Alert.alert(FAILURE_TITLES.remove, String(e)),
          ),
      },
    ]);
  }

  return (
    <View style={[styles.row, styles.rowWithLead]}>
      {/* The completion toggle, and the row's own affordance — deliberately
          outside the text below, so tapping through to the reminder (or to a
          tag or mention inside it) never flips it. Its label names the reminder
          because nothing else here does now that the button's words are gone. */}
      <Checkbox
        accessibilityLabel={done ? `Reopen “${label}”` : `Mark “${label}” done`}
        checked={done}
        onPress={toggle}
        style={styles.rowLeadCheckbox}
      />
      <View style={styles.rowBody}>
        <ReminderText
          text={heading}
          tags={reminder.tags}
          mentions={reminder.mentions}
          style={[styles.rowText, strike]}
          onPressText={open}
        />
        {reminder.title !== null && reminder.body !== null && (
          <ReminderText
            text={reminder.body}
            tags={reminder.tags}
            mentions={reminder.mentions}
            style={[styles.muted, strike]}
            onPressText={open}
          />
        )}
        <View style={styles.rowMeta}>
          {reminder.dueDate !== null ? (
            <Text style={styles.muted}>{formatDueIn(reminder.dueDate)}</Text>
          ) : (
            <View />
          )}
          <View style={styles.rowActions}>
            {showsRemove(actions, done) && (
              <Pressable accessibilityRole="button" onPress={confirmDelete}>
                <Text style={[styles.link, styles.danger]}>Remove</Text>
              </Pressable>
            )}
          </View>
        </View>
        {actions.length > 0 && (
          // Whatever the row offers, on its own line and in offer order — which
          // is also order of escalating finality. They get a line rather than the
          // meta row because they are peers of one choice and belong side by
          // side. Each kind is offered at most once per row, so it keys.
          <View style={styles.rowOffers}>
            {actions.map((action) => {
              const offer = offerFor(action);
              return (
                <Pressable
                  key={action.kind}
                  accessibilityRole="button"
                  onPress={() => {
                    if (offer.kind === "navigate") router.push(offer.path);
                    else if (offer.kind === "snooze") snooze(offer.until);
                    else confirmDelete();
                  }}
                >
                  <Text style={styles.link}>{offer.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}
