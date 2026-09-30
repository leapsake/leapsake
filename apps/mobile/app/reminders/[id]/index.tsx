import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
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
import { onboardingRouteOf } from "@leapsake/core";
import type { PartyChoice } from "@leapsake/ui/headless";
import {
  reminderActionKey,
  reminderActionsOf,
  reminderRowOf,
} from "@leapsake/view-models";
import { ContactReachButtons } from "../../../components/ContactReachButtons";
import { PartnerField, linkedPartner } from "../../../components/PartnerField";
import { ReminderPromptFields } from "../../../components/ReminderPromptFields";
import { ReminderText } from "../../../components/ReminderText";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import {
  REMOVAL_COPY,
  isAnsweredInline,
  offerFor,
} from "../../../lib/reminder-row";
import { colors, styles } from "../../../lib/styles";

/** The title on the alert a failed write raises, naming which write failed. */
const FAILURE_TITLES = {
  complete: "Couldn’t update",
  snooze: "Couldn’t put this off",
  answerPrompt: "Couldn’t save your choice",
  remove: "Couldn’t delete",
} as const;

/** The completion control's two words; see {@link toggle}. */
const COMPLETION = { do: "Mark done", undo: "Reopen" } as const;

/** No title: the reminder's own words head the body. */
const HEADER = { title: "" } as const;

/**
 * A reminder's heading, details and every action it offers: the one place a
 * reminder is acted on (the app's README → A reminder row is a link).
 */
export default function ReminderDetailScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Null until a tick is touched, so the offered set stays the source and a
  // reload cannot clobber a tick already made.
  const [draft, setDraft] = useState<ReminderRuleInput[] | null>(null);
  // Who the anniversary is with; `undefined` until chosen or pre-filled.
  const [partner, setPartner] = useState<PartyChoice | null | undefined>(
    undefined,
  );
  const load = useCallback(
    () =>
      Promise.all([
        // Not `get`: the belated wording is derived on the engine's walk, so
        // the plain row would word this differently from the list.
        core.reminders.getInWindow(id),
        // Gifts, the prompt's offers and contact ways: one engine walk.
        core.reminders.targets(),
        // Content-addressed on the live pairs, so no static table holds it.
        core.duplicates.nudgeId(),
      ]),
    [core, id],
  );
  const { data, error } = useFocusedData(load);

  // Every branch mounts the header: options come from the mounted
  // `<Stack.Screen>`, so a branch without one leaves the screen unnamed.
  if (error !== null) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={HEADER} />
        <Text style={styles.danger}>{error}</Text>
      </View>
    );
  }
  if (data === null) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={HEADER} />
        <ActivityIndicator />
      </View>
    );
  }

  const [reminder, targets, duplicatesNudgeId] = data;

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
  // With no title the body is the heading, and is not repeated below.
  const heading = reminder.title ?? reminder.body ?? "";
  const label = reminderLabel(reminder);
  const planTarget = targets.plans.find((t) => t.reminderId === id);
  // A `🗓 plan` prompt is drawn as a question, with its answer form inline.
  const isPrompt = planTarget !== undefined;
  const isOnboardingNudge = onboardingRouteOf(id) !== null;
  // Only an errand can be completed: a prompt retires by being answered, a
  // first-run nudge when its condition is met.
  const isErrand = !isPrompt && !isOnboardingNudge;
  // Only on a `wish` about a person (one per partner for a couple); with no
  // contact methods the view-model offers the collect prompt instead.
  const contactTargets = targets.contacts.filter((t) => t.reminderId === id);
  const linkPartnerTarget = targets.linkPartners.find(
    (t) => t.reminderId === id,
  );
  const contactTarget = contactTargets[0];
  const actions = reminderActionsOf(reminder, {
    giftTarget: targets.gifts.find((t) => t.reminderId === id),
    isDuplicatesNudge: id === duplicatesNudgeId,
    planTarget,
    // Knows a partner, not the date: "When is your anniversary?"
    partnershipTarget: targets.partnerships.find((t) => t.reminderId === id),
    // Knows the date, not the other party of the wedding.
    linkPartnerTarget,
    contactTarget:
      contactTarget === undefined
        ? undefined
        : {
            personId: contactTarget.personId,
            hasMethods: contactTargets.some((t) => t.methods.length > 0),
          },
  });
  // On a prompt, the offers the inline form answers are not drawn;
  // `reminderRowOf` still reads the full set.
  const offered = actions.filter((a) => !isPrompt || !isAnsweredInline(a));
  // A reminder offers at most one CTA; completion is filled only without one,
  // so two filled buttons never share a screen.
  const hasCta = offered.some((a) => offerFor(a).kind === "navigate");
  const row = reminderRowOf(actions, done);
  const removal = REMOVAL_COPY[row.removal];
  const canEdit = isReminderEditable(reminder);
  const canDelete = row.showsRemove;

  /** Finish or reopen this reminder, then go back to the list. */
  function toggle() {
    core.reminders.setCompleted(id, !done).then(
      () => router.back(),
      (e: unknown) => Alert.alert(FAILURE_TITLES.complete, String(e)),
    );
  }

  /** Put this reminder off by the offered day count (core picks the date),
   *  then go back, since it has left Today. */
  function snooze(days: number) {
    core.reminders.snooze(id, days).then(
      () => router.back(),
      (e: unknown) => Alert.alert(FAILURE_TITLES.snooze, String(e)),
    );
  }

  /** Write the milestone's whole rule set, disabled rows included, which
   *  retires the prompt; then go back. */
  function answer(milestoneId: string, schedule: ReminderRuleInput[]) {
    const write =
      partner != null && linkPartnerTarget !== undefined
        ? core.milestones.linkPartner({
            milestoneId,
            personId: linkPartnerTarget.personId,
            partner: linkedPartner(partner),
            reminderSchedule: schedule,
          })
        : core.milestones.update(milestoneId, { reminderSchedule: schedule });
    write.then(
      () => router.back(),
      (e: unknown) => Alert.alert(FAILURE_TITLES.answerPrompt, String(e)),
    );
  }

  /** The permanent out, from Delete and a nudge's "don't ask again" alike. */
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
    <ScrollView
      contentContainerStyle={styles.screen}
      // One tap picks a suggestion under "Who's it with?", keyboard up or not.
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={HEADER} />

      {/* Struck through when done, the only sign on screen that it is. */}
      <View>
        <ReminderText
          text={heading}
          tags={reminder.tags}
          mentions={reminder.mentions}
          style={[styles.reminderHeading, strike]}
        />
        {/* ⚠️ The occasion's own date. A prompt's "Due" is its deadline, weeks
            earlier, so it is not shown on a prompt. */}
        {isPrompt && planTarget.occurrenceDate != null && (
          <Text style={styles.promptOccasion}>
            {kindDefs[planTarget.milestoneKind].label} ·{" "}
            {formatDueIn(planTarget.occurrenceDate)} (
            {isoFromDueMs(planTarget.occurrenceDate)})
          </Text>
        )}
      </View>

      {/* The ways to reach them; with none, the offers below ask for one. */}
      {contactTargets.map((t) => (
        <ContactReachButtons
          key={t.personId}
          methods={t.methods}
          subjectName={t.subject}
          named={contactTargets.length > 1}
        />
      ))}

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
      {!isPrompt && reminder.dueDate !== null && (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Due</Text>
          <Text style={styles.fieldValue}>
            {isoFromDueMs(reminder.dueDate)} ({formatDueIn(reminder.dueDate)})
          </Text>
        </View>
      )}
      {/* The engine owns an automatic reminder's text, and a nudge offers its
          own "don't ask again", so either button can be absent. */}
      {(canEdit || canDelete) && (
        <View style={styles.buttonRow}>
          {canEdit && (
            // ⚠️ `flatten`: a `Link`'s child renders through `Slot`, which
            // throws on a `style` array rather than merging it.
            <Link href={`/reminders/${id}/edit`} asChild>
              <Pressable
                accessibilityRole="button"
                style={StyleSheet.flatten([
                  styles.buttonSecondary,
                  styles.buttonBlock,
                  styles.buttonFill,
                ])}
              >
                <Text style={styles.buttonSecondaryText}>Edit</Text>
              </Pressable>
            </Link>
          )}
          {canDelete && (
            <Pressable
              accessibilityRole="button"
              onPress={confirmDelete}
              style={[
                styles.button,
                styles.buttonDestructive,
                styles.buttonBlock,
                styles.buttonFill,
              ]}
            >
              <Text style={styles.buttonText}>Delete</Text>
            </Pressable>
          )}
        </View>
      )}
      {/* The prompt is answered here; Save untouched is "just the day". */}
      {planTarget !== undefined && (
        <View style={styles.promptForm}>
          {linkPartnerTarget !== undefined && (
            <PartnerField
              kind={linkPartnerTarget.milestoneKind}
              personId={linkPartnerTarget.personId}
              isSelf={linkPartnerTarget.isSelf}
              value={partner}
              onChange={setPartner}
            />
          )}
          {/* Says the ticks schedule reminders weeks out, not today's list. */}
          <Text style={styles.promptCaption}>
            We’ll remind you in time for each one.
          </Text>
          <ReminderPromptFields
            value={draft ?? planTarget.offers}
            greeting={kindDefs[planTarget.milestoneKind].greeting}
            onChange={setDraft}
          />
          <Pressable
            accessibilityRole="button"
            style={[styles.button, styles.buttonBlock]}
            onPress={() =>
              answer(planTarget.milestoneId, draft ?? planTarget.offers)
            }
          >
            <Text style={styles.buttonText}>Save</Text>
          </Pressable>
        </View>
      )}
      {(isErrand || offered.length > 0) && (
        // The offers, in offer order; each kind appears once, so it keys.
        <View style={styles.rowOffers}>
          {/* ⚠️ Errands only: `setCompleted` would stamp a nudge whose
              condition is unmet, leaving it in Completed for good. */}
          {isErrand && (
            <Pressable
              accessibilityRole="button"
              style={[
                hasCta ? styles.buttonSecondary : styles.button,
                styles.buttonBlock,
              ]}
              onPress={toggle}
            >
              <Text
                style={hasCta ? styles.buttonSecondaryText : styles.buttonText}
              >
                {done ? COMPLETION.undo : COMPLETION.do}
              </Text>
            </Pressable>
          )}
          {offered.map((action) => {
            const offer = offerFor(action);
            // The CTA is filled, the ways out quiet. A prompt's CTA was
            // dropped, so its Save is the one filled button.
            const isCta = offer.kind === "navigate";
            return (
              <Pressable
                key={reminderActionKey(action)}
                accessibilityRole="button"
                style={[
                  // "Don't ask again" is a tombstone, red like Delete.
                  offer.kind === "dismiss"
                    ? [styles.button, styles.buttonDestructive]
                    : isCta
                      ? styles.button
                      : styles.buttonSecondary,
                  styles.buttonBlock,
                ]}
                onPress={() => {
                  if (offer.kind === "navigate") router.push(offer.path);
                  else if (offer.kind === "answer-plan")
                    answer(offer.milestoneId, offer.schedule);
                  else if (offer.kind === "snooze") snooze(offer.days);
                  else if (offer.kind === "dismiss") confirmDelete();
                  // `answer-prompt` never gets here: `offered` dropped it.
                }}
              >
                <Text
                  style={
                    isCta || offer.kind === "dismiss"
                      ? styles.buttonText
                      : styles.buttonSecondaryText
                  }
                >
                  {offer.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
