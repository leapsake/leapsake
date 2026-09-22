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
import { reminderActionKey, reminderActionsOf } from "@leapsake/view-models";
import { ContactReachButtons } from "../../../components/ContactReachButtons";
import { ReminderPromptFields } from "../../../components/ReminderPromptFields";
import { ReminderText } from "../../../components/ReminderText";
import { useCore } from "../../../lib/core-context";
import { useFocusedData } from "../../../lib/useFocusedData";
import {
  isAnsweredInline,
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

/** The completion control's two words. One button, whose label says which way it
 *  goes — see {@link toggle}, which is one write with the boolean flipped. */
const COMPLETION = { do: "Mark done", undo: "Reopen" } as const;

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
 * Reminder detail: the reminder's heading, then its remaining details, then
 * **every** action it offers — edit, delete, *mark done*, plus whatever its kind
 * invites (a nudge's *do it* / *not now* / *don't ask again*, a gift reminder's
 * link to the recipient). Text shows its inline `#tags` verbatim — they *are*
 * the tags.
 *
 * The heading wears no "Title" label and there is no Status field: the
 * reminder's own words are the heading, and it strikes through when the thing is
 * done. That was a definition list describing a reminder; this is the reminder.
 *
 * **Completion is a button among the offers, not a checkbox beside the heading**
 * *(owner, 2026-09-13)*. A tick is a *state* you set, and it read as one — a
 * property of the record, sitting in the margin — when finishing a reminder is
 * the most consequential thing this screen does and belongs with the other
 * things you can do to it. A box 24pt across was also the smallest target on a
 * screen where every other choice is a full-width button, and the only one whose
 * meaning you had to infer from whether it was filled.
 *
 * The list row deliberately carries none of these — it is a link and nothing
 * else, so nothing on it can destroy a reminder or silence a nudge by mistap.
 * **Completion came here for the same reason**, the checkbox that used to sit on
 * its leading edge having been the one thing on Home that could. This screen is
 * where every one of those choices is made, with the room to word them honestly.
 * That is also why it reads the gift targets and the duplicates-nudge id the
 * list used to — `reminderActionsOf` needs both to know what to offer, and this
 * is now the only screen asking.
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
        // `getInWindow`, not `get`: part of what a reminder says is derived on
        // the engine's walk rather than stored — the belated wording — so
        // reading the plain row here would word this screen differently from
        // the list row that linked to it.
        core.reminders.getInWindow(id),
        // One read for all three affordances this screen offers: the gift loop,
        // the prompt's offer set (answered here rather than on a screen of its
        // own), and the ways this reminder's person can be reached. They are
        // three filters over one engine walk, and asking for them separately ran
        // that walk three times to draw one row.
        core.reminders.targets(),
        // The duplicates nudge is content-addressed on the outstanding pair set,
        // so unlike the onboarding nudges its id can't come from a static table —
        // core recomputes it from the live pairs and this matches on it.
        core.duplicates.nudgeId(),
      ]),
    [core, id],
  );
  const { data, error } = useFocusedData(load);

  // Every branch below mounts the header, including the ones that have nothing
  // to show yet: options are read from whichever `<Stack.Screen>` is mounted, so
  // a branch that omits it leaves the screen unnamed for as long as it is up.
  // They are mutually exclusive returns, so only ever one is mounted at a time.
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
  // Title leads; the body shows underneath as details. With no title the body
  // *is* the heading, so it isn't repeated below — the same choice the list makes.
  const heading = reminder.title ?? reminder.body ?? "";
  // How this reminder is *named* — in the removal confirmation, and in whatever
  // else needs to call it something. One source, so they all agree.
  const label = reminderLabel(reminder);
  // Everything this reminder offers, in offer order — the view-model is the only
  // authority on *what* is offered; this screen owns only how it looks. An
  // ordinary reminder (milestone / birthday / user) offers nothing.
  const planTarget = targets.plans.find((t) => t.reminderId === id);
  // A `🗓 plan` prompt, which this screen draws as a **question** rather than as
  // a reminder: its answer form is inline, so the reminder chrome that assumes
  // an errand is withheld — see each use below for what and why.
  const isPrompt = planTarget !== undefined;
  // A first-run nudge, told from its well-known id. Nothing else on this screen
  // needs to know — it feeds `isErrand` and nothing more.
  const isOnboardingNudge = onboardingRouteOf(id) !== null;
  /**
   * Whether this reminder is an **errand**: something with a doing in it that a
   * person finishes. Only an errand can be completed.
   *
   * The two exceptions are not exceptions to a rule about screens, they are two
   * things that are not errands. A `🗓 plan` prompt is a **question**, and
   * answering it is what retires it — Save below does that. A first-run nudge is
   * a **condition**, and it retires when the condition is met: adding a person
   * is what finishes "import your contacts", and nothing else can.
   */
  const isErrand = !isPrompt && !isOnboardingNudge;
  // Present only on a `wish` about a person. When they *have* methods this feeds
  // the buttons below and no CTA is offered; when they have none the view-model
  // turns it into the collect prompt. Either way the reminder stays completable
  // without it — a nudge, never a wall.
  // A couple's wish has one per partner, and asks for a way to reach the first
  // only when neither can be reached.
  const contactTargets = targets.contacts.filter((t) => t.reminderId === id);
  const contactTarget = contactTargets[0];
  const actions = reminderActionsOf(reminder, {
    giftTarget: targets.gifts.find((t) => t.reminderId === id),
    isDuplicatesNudge: id === duplicatesNudgeId,
    planTarget,
    // "When is your anniversary?" — the question the app asks when it knows you
    // have a partner and not the date. Its CTA opens the milestone form already
    // on the right kind.
    partnershipTarget: targets.partnerships.find((t) => t.reminderId === id),
    // A wedding whose other party was left unknown — the dual question: this one
    // knows the date and wants the couple.
    linkPartnerTarget: targets.linkPartners.find((t) => t.reminderId === id),
    contactTarget:
      contactTarget === undefined
        ? undefined
        : {
            personId: contactTarget.personId,
            hasMethods: contactTargets.some((t) => t.methods.length > 0),
          },
  });
  // What actually draws as a button. On a prompt that is the escapes and any
  // second CTA — never “Choose below” (which would point at the form already on
  // screen) or “Just the day” (which writes exactly what Save writes with the
  // offers untouched). `removalCopyFor` and `showsDelete` still read the **full**
  // set: whether this is a nudge is a fact about the reminder, not about which
  // of its offers this screen happens to draw.
  const offered = actions.filter((a) => !isPrompt || !isAnsweredInline(a));
  // Whether the reminder already has a filled button of its own. A reminder
  // offers at most one CTA and `navigate` is what picks it out, so this is the
  // same test the offers below use — read once here because the completion
  // button has to know too: it takes the filled style only when nothing else
  // has claimed it, so two of them never share a screen.
  const hasCta = offered.some((a) => offerFor(a).kind === "navigate");
  const removal = removalCopyFor(actions);
  const canEdit = isReminderEditable(reminder);
  const canDelete = showsDelete(actions, done);

  /**
   * Finish this reminder — or reopen it, which is the same write with the
   * boolean flipped.
   *
   * **We leave with it**, exactly as `snooze` and `answer` do, and for a reason
   * they did not have: this is now the *only* place a reminder can be completed,
   * Home's rows having become links and nothing else. Reloading in place would
   * leave the user on a detail screen for something they just finished, one tap
   * short of the list they were working through — three taps to tick a row that
   * used to take one. Going back is what makes it two.
   */
  function toggle() {
    core.reminders.setCompleted(id, !done).then(
      () => router.back(),
      (e: unknown) => Alert.alert(FAILURE_TITLES.complete, String(e)),
    );
  }

  /** Put this reminder off by the day count its offered action carried — core
   *  turns that into the day it comes back, by the rule that offered it, so
   *  nothing here derives a date. A put-off reminder leaves Today, so we leave
   *  with it rather than sit on a detail for a row the user just put off. */
  function snooze(days: number) {
    core.reminders.snooze(id, days).then(
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

      {/* The heading. It strikes through when the reminder is done — the only
          thing on screen that says so, the Status field being gone and the
          completion control having moved down among the offers. */}
      <View>
        <ReminderText
          text={heading}
          tags={reminder.tags}
          mentions={reminder.mentions}
          style={[styles.reminderHeading, strike]}
        />
        {/* ⚠️ The occasion's **own** date, said right under the question and
            nowhere else on a prompt. The "Due" this screen shows every other
            reminder is the prompt's deadline — six weeks before the occasion —
            so on a birthday that is tomorrow it reads "41 days ago", which is
            true of the question and false of the birthday. One line, under the
            thing it is about, instead of two fields disagreeing. */}
        {isPrompt && planTarget.occurrenceDate != null && (
          <Text style={styles.promptOccasion}>
            {kindDefs[planTarget.milestoneKind].label} ·{" "}
            {formatDueIn(planTarget.occurrenceDate)} (
            {isoFromDueMs(planTarget.occurrenceDate)})
          </Text>
        )}
      </View>

      {/* The ways to reach them, right under the acknowledgment they belong to —
          the channel choice made now rather than scheduled weeks ago. Renders
          nothing when there is nothing to offer; the collect prompt is a CTA in
          the offers below, so an empty strip here would say the same absence
          twice. Above Details deliberately: it is the thing to *do*, and Details
          is something to read. */}
      {contactTargets.map((t) => (
        <ContactReachButtons
          key={t.personId}
          methods={t.methods}
          subjectName={t.subject}
          named={contactTargets.length > 1}
        />
      ))}

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
      {!isPrompt && reminder.dueDate !== null && (
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
        <View style={styles.buttonRow}>
          {canEdit && (
            // `asChild`, so the route stays declarative while the thing on screen
            // is a button rather than an underlined word. Everything tappable on
            // this screen is now a box you can hit without aiming.
            //
            // ⚠️ `flatten`, because a `Link`'s child is rendered through `Slot`,
            // which **throws** on a `style` array rather than merging it — the
            // one way this composes differently from every other button here.
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
                styles.buttonSecondary,
                styles.buttonBlock,
                styles.buttonFill,
              ]}
            >
              <Text
                style={[
                  styles.buttonSecondaryText,
                  styles.buttonDestructiveText,
                ]}
              >
                Delete
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {/* ⚠️ The prompt is answered **here**, not on a screen further in. The
          Home row stays a checkbox and a link — that rule is what keeps a list
          row from destroying anything — so this screen carries the cost of
          making the answer cheap. The answer most people give still costs one
          tap: the offers arrive with the wish already ticked, so Save untouched
          *is* "just the day". It used to be a second button saying so, beside a
          third that pointed at this very form. */}
      {planTarget !== undefined && (
        <View style={styles.promptForm}>
          {/* What a tick actually buys, said once above the set rather than
              implied by four switches. Without it the toggles read as today's
              to-do list, when what they schedule is a reminder weeks out — the
              lead time on each row is the other half of the same sentence. */}
          <Text style={styles.promptCaption}>
            We’ll remind you in time for each one.
          </Text>
          <ReminderPromptFields
            value={draft ?? planTarget.offers}
            greeting={kindDefs[planTarget.milestoneKind].greeting}
            onChange={setDraft}
          />
          {/* The one commit, and it looks like one. It used to be a blue word in
              a row of four blue words, one of which wrote the same rules under a
              different name and one of which did nothing at all. */}
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
        // Whatever the reminder offers, on its own line and in offer order —
        // which is also order of escalating finality. They sit below the standing
        // actions because they are peers of one choice and belong side by side.
        // Each kind is offered at most once, so it keys.
        <View style={styles.rowOffers}>
          {/* Finishing it — first, because it is what the reminder is *for*, and
              because the offers under it run from "do it" to "never ask again"
              and this is the top of that scale.

              ⚠️ **Only an errand gets one** (see {@link isErrand}). Offered on a
              *question* it invites a fifth answer to a form that already has
              four, and means something the write cannot honour. Offered on a
              *condition* it means less than that: `setCompleted` will happily
              stamp a nudge, but the step's condition is still unmet, so the next
              reconcile keeps wanting the row and it simply sits in Completed for
              good — no snooze spent, no dismissal recorded, and the thing it
              asked for still not done. Withholding the control is the fix; the
              write stays open because the engine's own materialization uses it.

              It wears the filled button only when the reminder has no call to
              action of its own ({@link hasCta}) — on a gift reminder "See their
              gifts ›" is the thing to do next, and two filled buttons would make
              the screen say so twice. No `accessibilityLabel`: the label on it
              is already the whole of what it does. */}
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
            // The call to action wears the filled button; the ways out wear the
            // quiet one. A reminder offers at most one CTA, so `navigate` picks
            // it out without counting — and a prompt has none (its CTA points at
            // the form above and is dropped), which is why Save can be the filled
            // button there without two of them ever sharing a screen.
            const isCta = offer.kind === "navigate";
            return (
              <Pressable
                key={reminderActionKey(action)}
                accessibilityRole="button"
                style={[
                  isCta ? styles.button : styles.buttonSecondary,
                  styles.buttonBlock,
                ]}
                onPress={() => {
                  if (offer.kind === "navigate") router.push(offer.path);
                  else if (offer.kind === "answer-plan")
                    answer(offer.milestoneId, offer.schedule);
                  else if (offer.kind === "snooze") snooze(offer.days);
                  else if (offer.kind === "dismiss") confirmDelete();
                  // `answer-prompt` reaches no branch and needs none: it is the
                  // CTA that points at this screen's own form, and `offered` has
                  // already dropped it. It stays in the view-model for desktop,
                  // where the form really is a screen away.
                }}
              >
                <Text
                  style={
                    isCta
                      ? styles.buttonText
                      : [
                          styles.buttonSecondaryText,
                          // "Don't ask again" is a tombstone, and the only offer
                          // that is. It reads in the same red as Delete, which is
                          // the other way to the same write.
                          offer.kind === "dismiss" &&
                            styles.buttonDestructiveText,
                        ]
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
