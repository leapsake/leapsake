import type { OnboardingRoute } from "@leapsake/core";
import type { ReminderRuleInput } from "@leapsake/schema";
import type { ReminderCta, ReminderRowAction } from "@leapsake/view-models";

/** Each onboarding nudge's abstract {@link OnboardingRoute} as this client's own
 *  expo-router path — where its call to action leads. */
const ONBOARDING_PATH: Record<OnboardingRoute, string> = {
  // The importer, which is where getting started begins now. It links on to the
  // create form (and back) for the person adding someone by hand, so the manual
  // path costs one tap rather than a second nudge.
  import: "/import",
  // Account is a root-stack screen (reached from the Settings tab), not a tab
  // of its own, so the nudge pushes it like any other detail route.
  "create-account": "/settings",
  // The notifications screen is where the policy is chosen, and choosing one is
  // what fires the OS permission request (`lib/notification-permission.ts`) — so
  // the CTA is a soft ask by construction, and nothing here has to arrange one.
  "enable-notifications": "/notifications",
  // The one screen that sets the self-person. It replaced the People list's
  // pick mode, which could only ask "which of these is you?" and so could only be
  // asked once somebody was in the app; this one also takes the answer as a form.
  "about-you": "/about-you",
};

/**
 * The copy for everything a row can offer.
 *
 * `›` marks a label that **navigates**, which is this client's own convention
 * (desktop writes `→`). That is exactly why `snooze` and `dismiss` don't wear
 * one: neither goes anywhere. Their words match desktop's because the words are
 * right, not because they were inherited. Which onboarding routes get a named
 * label and which share the generic one is {@link ONBOARDING_LABEL}'s business.
 *
 * Each offered `snooze` names how long it lasts ({@link remindMeLabel}): “Not
 * now” alone never said whether the row was going away for an afternoon or for
 * good, which is the same ambiguity “Don't ask again” was introduced to fix at
 * the other end. One hand-rolled plural is the whole cost.
 */
const OFFER_LABELS = {
  onboarding: "Get started ›",
  createAccount: "Create your account ›",
  // Named because the row's own title stopped carrying the verb: it says
  // *Import your contacts*, and "Get started ›" under that asks the reader to
  // join the two up. One word, and the button says what the tap does.
  importContacts: "Import ›",
  // Named for a plainer reason. "Get started" reads as *begin something* —
  // wrong under a row asking you to flip a switch, which begins nothing.
  turnOn: "Turn them on ›",
  duplicates: "Review ›",
  seeGifts: "See their gifts ›",
  recordGiving: "Record what you gave ›",
  // A person with no way to reach them. Worded as an offer of help rather than
  // as a missing field — the reminder is completable without it, and the copy
  // should not imply otherwise.
  addContact: "Add a way to reach them ›",
  // The partnership question. Worded as the answer, not the question again: the
  // row already asked, and the button is what answers it.
  addDate: "Add the date ›",
  // An unbound wedding. Worded as the offer, not as a reproach for an incomplete
  // record — the reminder works perfectly well without it.
  linkPartner: "Add who it's with ›",
  // Your own wedding, with the other half of it not in the app yet. Named
  // rather than generic: at that moment the app knows exactly what it is short
  // of, and asking for it plainly is shorter than describing it.
  linkSpouse: "Who is your spouse? ›",
  // No "›": the prompt is answered **on this screen**, not somewhere else. It is
  // the one CTA that navigates nowhere, which is why `RowOffer` needed a fourth
  // kind rather than a fourth path.
  //
  // ⚠️ **Nothing draws it.** The detail screen carries the form inline, so this
  // would point a button at something already on it — see {@link isAnsweredInline},
  // which is what drops it. The mapping stays complete because the action is the
  // view-model's, shared with desktop, where the form really is a screen away.
  answerPrompt: "Choose below",
  // Likewise undrawn on this client, and for a sharper reason: with the offers
  // seeded from the kind's defaults (wish alone ticked), this writes exactly
  // what Save writes untouched. Two buttons, one outcome.
  justTheDay: "Just the day",
  dismiss: "Don’t ask again",
} as const;

/** The words on a “Remind me in…” button, for any whole number of days — so a
 *  user-chosen duration later reuses them rather than growing a second set. */
function remindMeLabel(days: number): string {
  if (days === 1) return "Remind me tomorrow";
  if (days === 7) return "Remind me next week";
  return `Remind me in ${days} days`;
}

/**
 * One offered action as this client renders it — the copy, plus how it is taken.
 *
 * Flatter than desktop's equivalent, and deliberately: desktop routes both the
 * put-off and the dismiss through router paths, whereas mobile calls core
 * in-process and confirms in an `Alert`, so neither needs a destination and
 * neither needs the reminder's id.
 */
export type RowOffer =
  | { kind: "navigate"; path: string; label: string }
  | { kind: "answer-prompt"; label: string }
  | {
      kind: "answer-plan";
      milestoneId: string;
      schedule: ReminderRuleInput[];
      label: string;
    }
  | { kind: "snooze"; days: number; label: string }
  | { kind: "dismiss"; label: string };

/**
 * What each nudge's call to action says. Named wherever the generic word would
 * mislead or leave the act unsaid; generic on the one route where it still reads
 * — **about you**, whose title asks a question ("Tell us about yourself") that
 * the button is simply the way into.
 *
 * The two **custody** routes are one fork — sign in to an account you have, or
 * create one — sat on Home together, and a shared "Get started" under both is the
 * flattening the fork exists to prevent: it reads as *begin something new* under
 * a row offering to get a returning user back into what they already have.
 *
 * **Import** was the route the generic word was *for*, until its title stopped
 * carrying the verb *(owner, 2026-09-13)*: "Import your contacts to get started"
 * became "Import your contacts", and under that "Get started ›" asks the reader
 * to join the two up. "Import ›" is the same tap with nothing left to infer.
 *
 * **Notifications** is named for a plainer version of the custody objection: it
 * begins nothing. It is a switch, and "Get started ›" over a switch promises a
 * flow that isn't there.
 *
 * Desktop names every route; this is the narrower version of that, now one route
 * short of it.
 */
const ONBOARDING_LABEL: Record<OnboardingRoute, string> = {
  import: OFFER_LABELS.importContacts,
  "create-account": OFFER_LABELS.createAccount,
  "enable-notifications": OFFER_LABELS.turnOn,
  "about-you": OFFER_LABELS.onboarding,
};

/** A `🎁 gift` reminder's CTA path. The target flips once the reminder is done
 *  (see `reminderCtaOf`, which holds the *why*): from the recipient's own page,
 *  whose Gifts section lists what's suggested for them, to the capture form fixed
 *  to them, to log what was actually given.
 *
 *  `given=1` is what opens that form ticked, and it is sent from here rather than
 *  inferred from the recipient — the same person's Gifts section links to the same
 *  form with the same recipient and means the opposite. */
function giftPath(cta: Extract<ReminderCta, { kind: "gift" }>): string {
  const party = `${cta.recipientType}:${cta.recipientId}`;
  return cta.action === "record-giving"
    ? `/gifts/new?recipient=${encodeURIComponent(party)}&given=1`
    : `${cta.recipientType === "pet" ? "/pets" : "/people"}/${cta.recipientId}`;
}

/** A reminder's call to action in this client's terms — the path it leads to
 *  plus its copy. See `reminderCtaOf`, which holds the *why* of each kind. */
function ctaOffer(cta: ReminderCta): RowOffer {
  switch (cta.kind) {
    case "onboarding":
      return {
        kind: "navigate",
        path: ONBOARDING_PATH[cta.route],
        label: ONBOARDING_LABEL[cta.route],
      };
    case "duplicates":
      return {
        kind: "navigate",
        path: "/duplicates",
        label: OFFER_LABELS.duplicates,
      };
    case "plan":
      // ⚠️ The prompt is a **question**, and mobile answers it in place. Its
      // Home row stays a checkbox and a link — that rule is what keeps a list row
      // from destroying anything — so the offer set is rendered on the detail
      // screen this offer already belongs to, and the CTA points at it rather
      // than off to a settings screen.
      return { kind: "answer-prompt", label: OFFER_LABELS.answerPrompt };
    case "gift":
      return {
        kind: "navigate",
        path: giftPath(cta),
        label:
          cta.action === "record-giving"
            ? OFFER_LABELS.recordGiving
            : OFFER_LABELS.seeGifts,
      };
    case "contact":
      // Straight to the form that adds one, not to the person's page: the CTA is
      // shown precisely because they have no methods, so their page would open
      // on an empty Contact section and ask for one more tap to reach the same
      // place.
      return {
        kind: "navigate",
        path: `/people/${cta.personId}/contacts/new`,
        label: OFFER_LABELS.addContact,
      };
    // Straight into the milestone form for this relationship, already on the
    // kind the question asked about — a blank kind picker would hand the
    // question back to the person who was just asked it.
    case "partnership":
      return {
        kind: "navigate",
        path: `/relationships/${cta.relationshipId}/milestones/new?kind=${cta.milestoneKind}`,
        label: OFFER_LABELS.addDate,
      };
    // The prompt asks this on its own form; every later row comes here.
    case "link-partner":
      return {
        kind: "navigate",
        path: `/people/${cta.personId}/milestones/${cta.milestoneId}/partner`,
        label: cta.isSelf ? OFFER_LABELS.linkSpouse : OFFER_LABELS.linkPartner,
      };
  }
}

/**
 * What one {@link ReminderRowAction} looks like on mobile, so the row component
 * renders and decides nothing.
 *
 * A snooze passes its day count through **verbatim**; which day that lands on is
 * core's to decide when the write is made, by the rule that offered it.
 */
export function offerFor(action: ReminderRowAction): RowOffer {
  switch (action.kind) {
    case "cta":
      return ctaOffer(action.cta);
    case "answer-plan":
      return {
        kind: "answer-plan",
        milestoneId: action.milestoneId,
        schedule: action.schedule,
        label: OFFER_LABELS.justTheDay,
      };
    case "snooze":
      return {
        kind: "snooze",
        days: action.days,
        label: remindMeLabel(action.days),
      };
    case "dismiss":
      return { kind: "dismiss", label: OFFER_LABELS.dismiss };
  }
}

/**
 * Whether this offer is one the detail screen's **inline prompt form** already
 * carries, and so must not also draw as a button.
 *
 * Both are answers to the question the form is asking. “Choose below” is the
 * navigation desktop needs and mobile does not — it would point at a form
 * already on screen — and “Just the day” writes exactly what Save writes with
 * the offer set untouched, since a prompt is only ever seeded from its kind's
 * defaults (`resolveReminderSchedule(kind, [])`) and those arrive with the wish
 * alone ticked. Two buttons for one outcome, one of which led nowhere. Who
 * the anniversary is with is asked on the form too.
 *
 * The actions stay in the view-model, which serves both clients: desktop's
 * prompt *is* a screen further in, and its CTA still has somewhere to go.
 */
export function isAnsweredInline(action: ReminderRowAction): boolean {
  return (
    action.kind === "answer-plan" ||
    (action.kind === "cta" &&
      (action.cta.kind === "plan" || action.cta.kind === "link-partner"))
  );
}

/** Whether these offers belong to a row whose permanent out is *don't ask again*
 *  — an onboarding nudge or a `🗓 plan` prompt. The seam both the `Delete` rule
 *  and the confirmation copy branch on; the CTA kind answers it, so neither has
 *  to pull the reminder engine into the app bundle.
 *
 *  A prompt joins the nudges here because it is the same shape of thing: a
 *  question Leapsake asked unbidden, whose removal has always been a permanent
 *  tombstone, and which therefore needs that said out loud rather than hidden
 *  behind "Delete reminder?". */
function isNudge(actions: readonly ReminderRowAction[]): boolean {
  return actions.some(
    (a) =>
      a.kind === "cta" &&
      (a.cta.kind === "onboarding" || a.cta.kind === "plan"),
  );
}

/**
 * Whether the detail screen shows its `Delete` — **no**, while the reminder is an
 * open onboarding nudge.
 *
 * `reminderActionsOf` withholds `dismiss` from ordinary reminders precisely
 * because `Delete` already gives them that affordance, and this is the mirror of
 * that: a nudge's permanent out is “don't ask again”, so showing both would be
 * two buttons for one tombstone. It also delivers the rule that a *first*
 * encounter is a genuinely binary choice — do it, or not now — since the action
 * list withholds dismiss until the second, and leaving `Delete` there would hand
 * back the permanent option under a label that hides what it does.
 *
 * A **completed** nudge keeps it. Its offers collapse to the CTA alone, so
 * without this a user who marked a nudge done would have no way to be rid of it;
 * and a finished nudge is an ordinary reminder again.
 */
export function showsDelete(
  actions: readonly ReminderRowAction[],
  done: boolean,
): boolean {
  return done || !isNudge(actions);
}

/** What the removal confirmation says. `message` takes the reminder's label as a
 *  function rather than being spliced together at the call site, so word order
 *  and quoting stay the language's business. */
export interface RemovalCopy {
  title: string;
  message: (label: string) => string;
  confirm: string;
}

const REMOVE_COPY: RemovalCopy = {
  title: "Delete reminder",
  message: (label) => `Delete “${label}”?`,
  confirm: "Delete",
};

/**
 * Removing an onboarding nudge has *always* been permanent — the engine
 * soft-deletes it and reconcile never resurrects a tombstoned id — so this isn't
 * a new outcome, it is the existing one finally saying what it does. Calling it
 * "Delete reminder?" is what let a user who meant *hide it* get *never show it
 * again* without being told.
 */
const DISMISS_COPY: RemovalCopy = {
  title: "Stop asking about this?",
  message: (label) => `Leapsake won’t ask about “${label}” again.`,
  confirm: "Don’t ask again",
};

/**
 * The confirmation worded for the row it was handed.
 *
 * Branching on the reminder rather than on which affordance was tapped means the
 * honest copy cannot be bypassed by whichever one got you here — and a completed
 * nudge's `Delete` is exactly such an affordance.
 */
export function removalCopyFor(
  actions: readonly ReminderRowAction[],
): RemovalCopy {
  return isNudge(actions) ? DISMISS_COPY : REMOVE_COPY;
}
