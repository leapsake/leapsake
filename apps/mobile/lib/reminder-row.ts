import type { OnboardingRoute } from "@leapsake/core";
import type { ReminderCta, ReminderRowAction } from "@leapsake/view-models";

/** Each onboarding nudge's abstract {@link OnboardingRoute} as this client's own
 *  expo-router path — where its call to action leads. */
const ONBOARDING_PATH: Record<OnboardingRoute, string> = {
  // The combined create form, which opens on its Person half — there is no
  // person-only create route any more.
  "add-person": "/add",
  // Settings is a root-stack screen (reached from the Menu tab), not a tab of
  // its own, so the nudge pushes it like any other detail route.
  "connect-sync": "/settings",
  // Pick-yourself deep-links to the People list in its pick mode, where each
  // Person row offers "This is me".
  "pick-self": "/(tabs)/people?pick=self",
};

/**
 * The copy for everything a row can offer.
 *
 * `›` marks a label that **navigates**, which is this client's own convention
 * (desktop writes `→`, and names each onboarding route where mobile says one
 * generic "Get started"). That is exactly why `snooze` and `dismiss` don't wear
 * one: neither goes anywhere. Their words match desktop's because the words are
 * right, not because they were inherited.
 *
 * The offered `snooze` carries the date it runs to, so “Not now (ask me in 3
 * days)” is available for free; it isn't spent here, because saying a date in
 * words means hand-rolling a plural rule in a screen with no message catalog.
 */
const OFFER_LABELS = {
  onboarding: "Get started ›",
  duplicates: "Review ›",
  seeGifts: "See their gifts ›",
  recordGiving: "Record what you gave ›",
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
  | { kind: "snooze"; until: number; label: string }
  | { kind: "dismiss"; label: string };

/** A `🎁 gift` reminder's CTA path. The target flips once the reminder is done
 *  (see `reminderCtaOf`, which holds the *why*): from the recipient's own page,
 *  whose Gifts section lists what's suggested for them, to the capture form fixed
 *  to them, to log what was actually given. */
function giftPath(cta: Extract<ReminderCta, { kind: "gift" }>): string {
  const party = `${cta.recipientType}:${cta.recipientId}`;
  return cta.action === "record-giving"
    ? `/gifts/new?recipient=${encodeURIComponent(party)}`
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
        label: OFFER_LABELS.onboarding,
      };
    case "duplicates":
      return {
        kind: "navigate",
        path: "/duplicates",
        label: OFFER_LABELS.duplicates,
      };
    case "gift":
      return {
        kind: "navigate",
        path: giftPath(cta),
        label:
          cta.action === "record-giving"
            ? OFFER_LABELS.recordGiving
            : OFFER_LABELS.seeGifts,
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

/**
 * Where tapping the row's *text* goes — its own affordance, separate from the
 * offers line.
 *
 * A dateless nudge deep-links to the screen it asks for, rather than to a
 * reminder detail the engine owns and the user cannot edit. Everything else,
 * **including a gift reminder**, taps through to its detail: a gift row is an
 * ordinary dated reminder that happens to offer a link, so its text should behave
 * like every other row's.
 *
 * That this duplicates the CTA is fine, and is not the "two buttons, one write"
 * problem `showsRemove` guards: tapping through is non-destructive and
 * reversible, and a large tap target on the row text is the native list idiom.
 */
export function tapPathFor(
  cta: ReminderCta | null,
  reminderId: string,
): string {
  if (cta?.kind === "onboarding") return ONBOARDING_PATH[cta.route];
  if (cta?.kind === "duplicates") return "/duplicates";
  return `/reminders/${reminderId}`;
}

/** Whether these offers belong to an onboarding nudge — the seam both the
 *  `Remove` rule and the confirmation copy branch on. The CTA kind answers it, so
 *  neither has to pull the reminder engine into the app bundle. */
function isNudge(actions: readonly ReminderRowAction[]): boolean {
  return actions.some((a) => a.kind === "cta" && a.cta.kind === "onboarding");
}

/**
 * Whether the row shows its own `Remove` — **no**, while it is an open
 * onboarding nudge.
 *
 * `reminderActionsOf` withholds `dismiss` from ordinary reminders precisely
 * because `Remove` already gives them that affordance, and this is the mirror of
 * that: a nudge's permanent out is “don't ask again”, so showing both would be
 * two buttons for one tombstone. It also delivers the rule that a *first*
 * encounter is a genuinely binary choice — do it, or not now — since the action
 * list withholds dismiss until the second, and leaving `Remove` there would hand
 * back the permanent option under a label that hides what it does.
 *
 * A **completed** nudge keeps it. Its offers collapse to the CTA alone, so
 * without this a user who marked a nudge done would have no way to clear it from
 * the foot of the list; and a finished row is an ordinary row again.
 */
export function showsRemove(
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
 * Branching on the row rather than on which affordance was tapped means the
 * honest copy cannot be bypassed by whichever one got you here — and a completed
 * nudge's `Remove` is exactly such an affordance.
 */
export function removalCopyFor(
  actions: readonly ReminderRowAction[],
): RemovalCopy {
  return isNudge(actions) ? DISMISS_COPY : REMOVE_COPY;
}
