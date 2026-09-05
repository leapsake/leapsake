import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  type ReminderRuleInput,
  formatDueIn,
  isReminderEditable,
  isoFromDueMs,
  kindDefs,
  reminderLabel,
} from "@leapsake/schema";
import { reminderActionsOf } from "@leapsake/view-models";
import { Checkbox } from "../../../components/Checkbox";
import { ReminderPromptFields } from "../../../components/ReminderPromptFields";
import { ReminderText } from "../../../components/ReminderText";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import {
  offerFor,
  removalCopyFor,
  showsDelete,
} from "../../../lib/reminder-row";
import { colors, styles } from "../../../lib/styles";

/** The title on the alert a failed write raises. Each says which write failed,
 *  since this screen offers several and a bare "Something went wrong" wouldn't. */
const FAILURE_TITLES = {
  complete: "Couldn’t update",
  snooze: "Couldn’t put this off",
  answerPrompt: "Couldn’t save your choice",
  remove: "Couldn’t delete",
} as const;

/**
 * The header: a back control and nothing else.
 *
 * No title, because the reminder's own words are the first thing in the body and
 * a title bar repeating them says the same sentence twice. `AppHeader` draws no
 * title element at all for an empty one, so this leaves a bare bar rather than a
 * blank band.
 *
 * This screen used to be pushed with a `?from=` naming whoever pushed it, because
 * a native stack labels its back button with the *previous* screen's title and
 * this screen has none to give. The app draws its own header now and every back
 * control reads a plain "‹ Back", so there is nothing left for that parameter to
 * feed and its callers no longer send it.
 */
const HEADER = { title: "" } as const;

/**
 * Reminder detail: the reminder's heading with its completion checkbox, then its
 * remaining details, then **every** action it offers — edit, delete, plus
 * whatever its kind invites (a nudge's *do it* / *not now* / *don't ask again*, a
 * gift reminder's link to the recipient). Text shows its inline `#tags` verbatim
 * — they *are* the tags.
 *
 * The heading wears no "Title" label and there is no Status field: the reminder's
 * own words are the heading, and completion is a checkbox you tap rather than a
 * word you read. Both were a definition list describing a reminder; this is the
 * reminder.
 *
 * The list row deliberately carries none of these: it has a completion checkbox
 * and nothing else, so nothing on it can destroy a reminder or silence a nudge by
 * mistap. This screen is where those choices are made, with the room to word them
 * honestly. That is also why it reads the gift targets and the duplicates-nudge
 * id the list used to — `reminderActionsOf` needs both to know what to offer, and
 * this is now the only screen asking.
 */
export default function ReminderDetailScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  // The prompt's unsaved ticks. Null until the user touches one, so the offered
  // set (with its pre-ticks) stays the source until there is an actual edit —
  // and a reload that re-reads the offers cannot clobber a tick already made.
  const [draft, setDraft] = useState<ReminderRuleInput[] | null>(null);
  const load = useCallback(
    () =>
      Promise.all([
        core.reminders.get(id),
        core.reminders.giftTargets(),
        // A prompt is answered here rather than on a screen of its own, so this
        // reads what it is asking about — the milestone, and the set of actions
        // it offers with their pre-ticks.
        core.reminders.planTargets(),
        // The duplicates nudge is content-addressed on the outstanding pair set,
        // so unlike the onboarding nudges its id can't come from a static table —
        // core recomputes it from the live pairs and this matches on it.
        core.duplicates.nudgeId(),
      ]),
    [core, id],
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

  const [reminder, giftTargets, planTargets, duplicatesNudgeId] = data;

  if (reminder === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={HEADER} />
        <Text style={styles.muted}>This reminder no longer exists.</Text>
      </View>
    );
  }

  const done = reminder.completedAt !== null;
  const strike = done
    ? { textDecorationLine: "line-through" as const, color: colors.muted }
    : undefined;
  // Title leads; the body shows underneath as details. With no title the body
  // *is* the heading, so it isn't repeated below — the same choice the list makes.
  const heading = reminder.title ?? reminder.body ?? "";
  // How this reminder is *named* — in the removal confirmation, and in whatever
  // else needs to call it something. One source, so they all agree.
  const label = reminderLabel(reminder);
  // Everything this reminder offers, in offer order — the view-model is the only
  // authority on *what* is offered; this screen owns only how it looks. An
  // ordinary reminder (milestone / birthday / user) offers nothing.
  const planTarget = planTargets.find((t) => t.reminderId === id);
  const actions = reminderActionsOf(reminder, {
    giftTarget: giftTargets.find((t) => t.reminderId === id),
    isDuplicatesNudge: id === duplicatesNudgeId,
    planTarget,
  });
  const removal = removalCopyFor(actions);
  const canEdit = isReminderEditable(reminder);
  const canDelete = showsDelete(actions, done);

  function toggle() {
    core.reminders.setCompleted(id, !done).then(
      () => reload(),
      (e: unknown) => Alert.alert(FAILURE_TITLES.complete, String(e)),
    );
  }

  /** Put this reminder off until the date its offered action carried — handed
   *  straight through, so nothing here re-derives a schedule. `snooze` spends the
   *  repetition itself, so there is no count to send. A put-off reminder drops out
   *  of the list, so we leave with it rather than sit on a detail for a row the
   *  user just asked not to see. */
  function snooze(until: number) {
    core.reminders.snooze(id, until).then(
      () => router.back(),
      (e: unknown) => Alert.alert(FAILURE_TITLES.snooze, String(e)),
    );
  }

  /**
   * Answer the prompt: write the milestone's whole rule set and let the engine
   * take it from there.
   *
   * The **whole** set, disabled rows included, never just the ticks — rows
   * existing is what makes "asked, and chose nothing" distinguishable from
   * "never asked", and a partial write would have the question return next year.
   * `milestones.update` replaces the set and reconciles in the same call, so the
   * prompt retires and the chosen errands appear together; we leave with it,
   * because the row this screen is about is now gone.
   */
  function answer(milestoneId: string, schedule: ReminderRuleInput[]) {
    core.milestones.update(milestoneId, { reminderSchedule: schedule }).then(
      () => router.back(),
      (e: unknown) => Alert.alert(FAILURE_TITLES.answerPrompt, String(e)),
    );
  }

  /**
   * The permanent out, reached from `Delete` and from a nudge's "don't ask
   * again" alike — one write, worded for whichever reminder it was handed.
   * Removing a nudge has always been permanent; only its presentation lied.
   */
  function confirmDelete() {
    Alert.alert(removal.title, removal.message(label), [
      { text: "Cancel", style: "cancel" },
      {
        text: removal.confirm,
        style: "destructive",
        onPress: () =>
          core.reminders.softDelete(id).then(
            () => router.back(),
            (e: unknown) => Alert.alert(FAILURE_TITLES.remove, String(e)),
          ),
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={HEADER} />

      {/* The heading, with completion beside it — the checkbox is the only thing
          that says whether this is done now that the Status field is gone, so the
          heading strikes through as well, exactly as the list's rows do. */}
      <View style={styles.rowWithLead}>
        <Checkbox
          accessibilityLabel={
            done ? `Reopen “${label}”` : `Mark “${label}” done`
          }
          checked={done}
          onPress={toggle}
          style={styles.rowLeadCheckbox}
        />
        <View style={styles.rowBody}>
          <ReminderText
            text={heading}
            tags={reminder.tags}
            mentions={reminder.mentions}
            style={[styles.reminderHeading, strike]}
          />
        </View>
      </View>

      {/* Only when there is a title as well: an untitled reminder's body *is* the
          heading above, and repeating it under a "Details" label would show the
          same sentence twice. Same rule the list applies. */}
      {reminder.title !== null && reminder.body !== null && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Details</Text>
          <ReminderText
            text={reminder.body}
            tags={reminder.tags}
            mentions={reminder.mentions}
            style={styles.fieldValue}
          />
        </View>
      )}
      {reminder.dueDate !== null && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Due</Text>
          <Text style={styles.fieldValue}>
            {isoFromDueMs(reminder.dueDate)} ({formatDueIn(reminder.dueDate)})
          </Text>
        </View>
      )}
      {/* Automatic (birthday) reminders aren't content-editable — the engine owns
          their text — so only user reminders get an Edit link; Delete is withheld
          while a nudge offers its own "don't ask again" (see `showsDelete`). Both
          can be absent at once — an open, engine-owned nudge — so the row is
          conditional rather than rendering an empty strip of actions. */}
      {(canEdit || canDelete) && (
        <View style={styles.rowActions}>
          {canEdit && (
            <Link href={`/reminders/${id}/edit`} style={styles.link}>
              Edit
            </Link>
          )}
          {canDelete && (
            <Pressable accessibilityRole="button" onPress={confirmDelete}>
              <Text style={[styles.link, styles.danger]}>Delete</Text>
            </Pressable>
          )}
        </View>
      )}
      {/* ⚠️ The prompt is answered **here**, not on a screen further in. The
          Home row stays a checkbox and a link — that rule is what keeps a list
          row from destroying anything — so this screen carries the cost of
          making the answer cheap. "Just the day" is among the offers below; it
          is the answer most people give, so it costs one tap and no scrolling
          past the list. */}
      {/* ⚠️ The "Due" above is the prompt's own deadline, six weeks before the
          occasion — the same convention every reminder row uses. So the
          occasion's real date is said here rather than left to be inferred from
          a countdown that is about something else. */}
      {planTarget?.occurrenceDate != null && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            {kindDefs[planTarget.milestoneKind].label}
          </Text>
          <Text style={styles.fieldValue}>
            {isoFromDueMs(planTarget.occurrenceDate)} (
            {formatDueIn(planTarget.occurrenceDate)})
          </Text>
        </View>
      )}
      {planTarget !== undefined && (
        <View style={styles.field}>
          <ReminderPromptFields
            value={draft ?? planTarget.offers}
            onChange={setDraft}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              answer(planTarget.milestoneId, draft ?? planTarget.offers)
            }
          >
            <Text style={styles.link}>Save</Text>
          </Pressable>
        </View>
      )}
      {actions.length > 0 && (
        // Whatever the reminder offers, on its own line and in offer order —
        // which is also order of escalating finality. They sit below the standing
        // actions because they are peers of one choice and belong side by side.
        // Each kind is offered at most once, so it keys.
        <View style={styles.rowOffers}>
          {actions.map((action) => {
            const offer = offerFor(action);
            return (
              <Pressable
                key={action.kind}
                accessibilityRole="button"
                onPress={() => {
                  if (offer.kind === "navigate") router.push(offer.path);
                  else if (offer.kind === "answer-plan")
                    answer(offer.milestoneId, offer.schedule);
                  else if (offer.kind === "snooze") snooze(offer.until);
                  else if (offer.kind === "dismiss") confirmDelete();
                }}
              >
                <Text style={styles.link}>{offer.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
