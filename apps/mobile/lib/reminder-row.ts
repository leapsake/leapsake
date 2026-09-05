import type { OnboardingRoute } from "@leapsake/core";
import type { ReminderRuleInput } from "@leapsake/schema";
import type { ReminderCta, ReminderRowAction } from "@leapsake/view-models";

/** Each onboarding nudge's abstract {@link OnboardingRoute} as this client's own
 *  expo-router path — where its call to action leads. */
const ONBOARDING_PATH: Record<OnboardingRoute, string> = {
  // The combined create form, which opens on its Person half — there is no
  // person-only create route any more.
  "add-person": "/add",
  // Account is a root-stack screen (reached from the Settings tab), not a tab
  // of its own, so the nudge pushes it like any other detail route. Both custody
  // routes land there today — an accountless Account screen renders
  // `CreateAccount` above `SyncSetup`, so each nudge's target is already on
  // screen — and they stay two routes so splitting the destination later is a
  // table edit.
  "connect-sync": "/settings",
  "create-account": "/settings",
  // Pick-yourself deep-links to the People list in its pick mode, where each
  // Person row offers "This is me".
  "pick-self": "/people?pick=self",
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
 * The offered `snooze` carries the date it runs to, so “Not now (ask me in 3
 * days)” is available for free; it isn't spent here, because saying a date in
 * words means hand-rolling a plural rule in a screen with no message catalog.
 */
const OFFER_LABELS = {
  onboarding: "Get started ›",
  signIn: "Sign in ›",
  createAccount: "Create your account ›",
  duplicates: "Review ›",
  seeGifts: "See their gifts ›",
  recordGiving: "Record what you gave ›",
  // A person with no way to reach them. Worded as an offer of help rather than
  // as a missing field — the reminder is completable without it, and the copy
  // should not imply otherwise.
  addContact: "Add a way to reach them ›",
  // No "›": the prompt is answered **on this screen**, not somewhere else. It is
  // the one CTA that navigates nowhere, which is why `RowOffer` needed a fourth
  // kind rather than a fourth path.
  answerPrompt: "Choose below",
  justTheDay: "Just the day",
  snooze: "Not now",
  dismiss: "Don’t ask again",
} as const;

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
  | { kind: "snooze"; until: number; label: string }
  | { kind: "dismiss"; label: string };

/**
 * What each nudge's call to action says. Generic where the row's own title
 * already names the act ("Add your first person" → *Get started*), and specific
 * for the two **custody** routes, where it cannot be.
 *
 * Those two are one fork — sign in to an account you have, or create one — sat on
 * Home together, and a shared "Get started" under both is the flattening the fork
 * exists to prevent: it reads as *begin something new* under a row offering to
 * get a returning user back into what they already have. Desktop names every
 * route for the same reason; this is the narrower version of that, spent where a
 * wrong turn used to cost the most.
 */
const ONBOARDING_LABEL: Record<OnboardingRoute, string> = {
  "add-person": OFFER_LABELS.onboarding,
  "connect-sync": OFFER_LABELS.signIn,
  "create-account": OFFER_LABELS.createAccount,
  "pick-self": OFFER_LABELS.onboarding,
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
  }
}

/**
 * What one {@link ReminderRowAction} looks like on mobile, so the row component
 * renders and decides nothing.
 *
 * A snooze's `until` is passed through **verbatim**. It is the date the snooze
 * policy chose and the offered action carried; recomputing it here would be a
 * second evaluation that disagrees with the first whenever a dial changes.
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
        until: action.until,
        label: OFFER_LABELS.snooze,
      };
    case "dismiss":
      return { kind: "dismiss", label: OFFER_LABELS.dismiss };
  }
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
