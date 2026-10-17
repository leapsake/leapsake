import { observanceIdFor } from "@leapsake/data";
import type {
  HiddenHolidaysRepo,
  HolidaysRepo,
  ObservancesRepo,
  PeopleRepo,
  PetsRepo,
  ReminderRulesRepo,
  UnaskedHolidaysRepo,
} from "@leapsake/data";
import {
  type HolidayPromptCandidate,
  holidayPlanReminderId,
} from "@leapsake/reminders";
import {
  type CivilDate,
  type Holiday,
  type Observance,
  type ObservanceBearerType,
  type ReminderAction,
  type ReminderRule,
  type ReminderRuleInput,
  MAX_ACTIVE_DAYS,
  OFFER_NOTICE_DAYS,
  actionKeyOf,
  daysUntil,
  dueDateMs,
  fitsAt,
  fullName,
  resolveObservanceReminderSchedule,
  verbOf,
} from "@leapsake/schema";
import { isAffiliated } from "./affiliation.js";
import {
  affiliationsFor,
  suggestionsFor,
  wishByDefaultFor,
} from "./catalog.js";
import {
  type ImplicitObservance,
  NO_IMPLICIT,
  bearerKey,
  observersOf,
  wishByDefaultOf,
} from "./observers.js";
import { civilFromIso, isoFromCivil, parseRecurrence } from "./recurrence.js";
import { createHolidayResolver } from "./resolver.js";

/** One person or pet on a prompt's wish line, ticked if they'll be wished. */
export interface PromptWish {
  bearerType: ObservanceBearerType;
  bearerId: string;
  label: string;
  wish: boolean;
}

/** Someone who could join a prompt's wish line. */
export interface PromptCandidate {
  bearerType: ObservanceBearerType;
  bearerId: string;
  label: string;
}

/** What one holiday's question offers for one occurrence. */
export interface HolidayPrompt {
  reminderId: string;
  holidayId: string;
  name: string;
  greeting: string;
  /** The occurrence asked about, `YYYY-MM-DD`. */
  occurrence: string;
  /** The same day as a due timestamp, for "in 5 weeks". */
  occurrenceDate: number;
  /** Who you are, or `null`, when an errand first needs you to say. */
  selfId: string | null;
  /** Your own errands, offered only if you keep it, ticked if on. */
  errands: ReminderRuleInput[];
  /** Everyone else who keeps it, while a day-of wish still fits. */
  wishes: PromptWish[];
  /** Who could be added to the wish line. */
  addable: PromptCandidate[];
}

/** A prompt's answer: every errand offered, ticked or not, and each wish
 *  shown or added. */
export interface HolidayPromptAnswer {
  errands: ReminderRuleInput[];
  wishes: {
    bearerType: ObservanceBearerType;
    bearerId: string;
    wish: boolean;
  }[];
}

/** Where a prompt's {@link HolidayPrompt.reminderId} came from. */
export interface HolidayPromptTarget {
  reminderId: string;
  holidayId: string;
  occurrence: string;
}

export interface HolidayPromptDeps {
  holidays: HolidaysRepo;
  observances: ObservancesRepo;
  hiddenHolidays: HiddenHolidaysRepo;
  unaskedHolidays: UnaskedHolidaysRepo;
  reminderRules: ReminderRulesRepo;
  people: PeopleRepo;
  pets: PetsRepo;
  implicit?: () => Promise<ImplicitObservance>;
}

/** One holiday as a prompt sees it. */
interface PromptContext {
  holiday: Holiday;
  stored: readonly Observance[];
  rulesByObservance: ReadonlyMap<string, readonly ReminderRule[]>;
  implicit: ImplicitObservance;
}

/** Every holiday that may ask, each with what it needs to; hidden and
 *  unasked holidays are left out. */
async function loadContexts(deps: HolidayPromptDeps): Promise<PromptContext[]> {
  const [rows, hidden, unasked, observances, rules, implicit] =
    await Promise.all([
      deps.holidays.list(),
      deps.hiddenHolidays.listHiddenIds(),
      deps.unaskedHolidays.listUnaskedIds(),
      deps.observances.list(),
      deps.reminderRules.listWhere({
        where: "bearer_type = ?",
        params: ["observance"],
      }),
      deps.implicit?.() ?? NO_IMPLICIT,
    ]);
  const rulesByObservance = new Map<string, ReminderRule[]>();
  for (const rule of rules)
    rulesByObservance.set(rule.bearerId, [
      ...(rulesByObservance.get(rule.bearerId) ?? []),
      rule,
    ]);
  return rows
    .filter((row) => !hidden.has(row.id) && !unasked.has(row.id))
    .map((holiday) => ({
      holiday,
      stored: observances.filter((o) => o.holidayId === holiday.id),
      rulesByObservance,
      implicit,
    }));
}

function rulesOf(
  ctx: PromptContext,
  bearerType: ObservanceBearerType,
  bearerId: string,
): readonly ReminderRule[] {
  return (
    ctx.rulesByObservance.get(
      observanceIdFor(ctx.holiday.id, bearerType, bearerId),
    ) ?? []
  );
}

const asInput = (rule: ReminderRule): ReminderRuleInput => ({
  action: rule.action,
  label: rule.label,
  offsetDays: rule.offsetDays,
  enabled: rule.enabled,
});

/** Whether you keep the holiday; before anyone is you, whether your country
 *  does. */
function youKeep(ctx: PromptContext): boolean {
  const { selfId, yourCountry } = ctx.implicit;
  if (selfId !== null)
    return observersOf(ctx.holiday, ctx.stored, ctx.implicit).some(
      (o) => o.bearerType === "person" && o.bearerId === selfId,
    );
  const keptBy =
    ctx.holiday.origin === "catalog" ? affiliationsFor(ctx.holiday.slug) : null;
  return (
    keptBy !== null &&
    isAffiliated(keptBy, {
      religions: [],
      countries: yourCountry === null ? [] : [yourCountry],
    })
  );
}

/** Everyone but you who keeps the holiday. */
function othersOf(ctx: PromptContext) {
  return observersOf(ctx.holiday, ctx.stored, ctx.implicit).filter(
    (o) => !(o.bearerType === "person" && o.bearerId === ctx.implicit.selfId),
  );
}

/** The catalog's suggestions and your own errands, ticked as stored. */
function errandsOf(ctx: PromptContext): ReminderRuleInput[] {
  if (!youKeep(ctx)) return [];
  const { selfId } = ctx.implicit;
  const own = (selfId === null ? [] : rulesOf(ctx, "person", selfId))
    .filter((r) => verbOf(r.action) === "other")
    .map(asInput);
  const ownByKey = new Map(own.map((r) => [actionKeyOf(r), r]));
  const suggested = (
    ctx.holiday.origin === "catalog" ? suggestionsFor(ctx.holiday.slug) : []
  ).map(
    (s): ReminderRuleInput =>
      ownByKey.get(actionKeyOf({ action: "other", label: s.label })) ?? {
        action: "other",
        label: s.label,
        offsetDays: s.offsetDays,
        enabled: false,
      },
  );
  const suggestedKeys = new Set(suggested.map(actionKeyOf));
  return [
    ...suggested,
    ...own.filter((r) => !suggestedKeys.has(actionKeyOf(r))),
  ].sort((a, b) => b.offsetDays - a.offsetDays);
}

/** A bearer's schedule as it stands, stored or defaulted. */
function scheduleOf(
  ctx: PromptContext,
  bearerType: ObservanceBearerType,
  bearerId: string,
): ReminderRuleInput[] {
  return resolveObservanceReminderSchedule(
    [...rulesOf(ctx, bearerType, bearerId)],
    wishByDefaultOf(ctx.holiday, bearerId, ctx.implicit),
  );
}

function wishes(
  ctx: PromptContext,
  bearerType: ObservanceBearerType,
  bearerId: string,
): boolean {
  return scheduleOf(ctx, bearerType, bearerId).some(
    (r) => r.action === "wish" && r.enabled,
  );
}

/** Whether a holiday asks: it has an errand to suggest to you, a wish on by
 *  default for someone, or something already scheduled. */
function asks(ctx: PromptContext): boolean {
  const others = othersOf(ctx);
  const scheduled = observersOf(ctx.holiday, ctx.stored, ctx.implicit).some(
    (o) => rulesOf(ctx, o.bearerType, o.bearerId).some((r) => r.enabled),
  );
  return (
    (youKeep(ctx) &&
      ctx.holiday.origin === "catalog" &&
      suggestionsFor(ctx.holiday.slug).length > 0) ||
    (ctx.holiday.origin === "catalog" &&
      wishByDefaultFor(ctx.holiday.slug) &&
      others.length > 0) ||
    scheduled
  );
}

/** What the question offers, each with its lead. */
function offersOf(
  ctx: PromptContext,
): { action: ReminderAction; offsetDays: number }[] {
  return [
    ...errandsOf(ctx).map((r) => ({
      action: r.action,
      offsetDays: r.offsetDays,
    })),
    ...(othersOf(ctx).length > 0
      ? [{ action: "wish" as const, offsetDays: 0 }]
      : []),
  ];
}

/** The holidays that ask, for the reminder engine, with their occurrences
 *  out to the furthest a question could be on display. */
export async function holidayPromptCandidates(
  deps: HolidayPromptDeps & { today: CivilDate },
): Promise<HolidayPromptCandidate[]> {
  const contexts = (await loadContexts(deps)).filter(asks);
  const resolver = createHolidayResolver(
    contexts.map(({ holiday }) => ({
      slug: holiday.slug,
      recurrence: parseRecurrence(holiday.recurrence),
    })),
  );
  return contexts.flatMap((ctx) => {
    const offers = offersOf(ctx);
    if (offers.length === 0) return [];
    const furthest = Math.max(...offers.map((o) => o.offsetDays));
    const occurrences = resolver.upcomingOccurrences(
      ctx.holiday.slug,
      deps.today,
      MAX_ACTIVE_DAYS + furthest + OFFER_NOTICE_DAYS,
    );
    return occurrences.length === 0
      ? []
      : [
          {
            holidayId: ctx.holiday.id,
            occasion: ctx.holiday.name,
            occurrences: [...occurrences],
            offers,
          },
        ];
  });
}

/** Each question there could be today, by its reminder id. */
export async function holidayPromptTargets(
  deps: HolidayPromptDeps & { today: CivilDate },
): Promise<HolidayPromptTarget[]> {
  return (await holidayPromptCandidates(deps)).flatMap((c) =>
    c.occurrences.map((occ) => ({
      reminderId: holidayPlanReminderId(c.holidayId, isoFromCivil(occ)),
      holidayId: c.holidayId,
      occurrence: isoFromCivil(occ),
    })),
  );
}

/** One holiday's question for one occurrence, offering only what still fits
 *  by `today`; undefined if it doesn't ask. */
export async function holidayPrompt(
  deps: HolidayPromptDeps & { today: CivilDate },
  holidayId: string,
  occurrence: string,
): Promise<HolidayPrompt | undefined> {
  const ctx = (await loadContexts(deps)).find(
    (c) => c.holiday.id === holidayId,
  );
  const day = civilFromIso(occurrence);
  if (ctx === undefined || day === null || !asks(ctx)) return undefined;
  const daysOut = daysUntil(deps.today, day);

  const [people, pets] = await Promise.all([
    deps.people.list(),
    deps.pets.list(),
  ]);
  const labels = new Map([
    ...people.map((p) => [bearerKey("person", p.id), fullName(p)] as const),
    ...pets.map((p) => [bearerKey("pet", p.id), p.name] as const),
  ]);
  const others = othersOf(ctx);
  const onLine = new Set(
    others.map((o) => bearerKey(o.bearerType, o.bearerId)),
  );
  const wishFits = fitsAt("wish", 0, daysOut);
  const byLabel = (a: { label: string }, b: { label: string }) =>
    a.label.localeCompare(b.label);

  return {
    reminderId: holidayPlanReminderId(holidayId, occurrence),
    holidayId,
    name: ctx.holiday.name,
    greeting: ctx.holiday.greeting,
    occurrence,
    occurrenceDate: dueDateMs(day),
    selfId: ctx.implicit.selfId,
    errands: errandsOf(ctx).filter((r) =>
      fitsAt(r.action, r.offsetDays, daysOut),
    ),
    wishes: wishFits
      ? others
          .flatMap((o) => {
            const label = labels.get(bearerKey(o.bearerType, o.bearerId));
            return label === undefined
              ? []
              : [{ ...o, label, wish: wishes(ctx, o.bearerType, o.bearerId) }];
          })
          .sort(byLabel)
      : [],
    addable: wishFits
      ? [
          ...people.map((p) => ({
            bearerType: "person" as const,
            bearerId: p.id,
            label: fullName(p),
          })),
          ...pets.map((p) => ({
            bearerType: "pet" as const,
            bearerId: p.id,
            label: p.name,
          })),
        ]
          .filter(
            (c) =>
              !onLine.has(bearerKey(c.bearerType, c.bearerId)) &&
              !(
                c.bearerType === "person" && c.bearerId === ctx.implicit.selfId
              ),
          )
          .sort(byLabel)
      : [],
  };
}

/** A schedule as the answer leaves it: each answered rule replacing its own,
 *  the rest kept. */
function withAnswered(
  schedule: readonly ReminderRuleInput[],
  answered: readonly ReminderRuleInput[],
): ReminderRuleInput[] {
  const keys = new Set(answered.map(actionKeyOf));
  return [...schedule.filter((r) => !keys.has(actionKeyOf(r))), ...answered];
}

/** The schedules an answer writes: your errands onto yours, and each changed
 *  wish onto its bearer's. Untouched ones stay unstored, on the defaults. */
export async function holidayPromptWrites(
  deps: HolidayPromptDeps,
  holidayId: string,
  answer: HolidayPromptAnswer,
): Promise<
  {
    bearerType: ObservanceBearerType;
    bearerId: string;
    rules: ReminderRuleInput[];
  }[]
> {
  const contexts = await loadContexts(deps);
  const ctx = contexts.find((c) => c.holiday.id === holidayId);
  if (ctx === undefined) return [];
  const writes: {
    bearerType: ObservanceBearerType;
    bearerId: string;
    rules: ReminderRuleInput[];
  }[] = [];

  const { selfId } = ctx.implicit;
  const ownStored = selfId === null ? [] : rulesOf(ctx, "person", selfId);
  if (answer.errands.some((r) => r.enabled) || ownStored.length > 0) {
    if (selfId === null && answer.errands.some((r) => r.enabled))
      throw new Error("Say which person is you before ticking an errand.");
    if (selfId !== null)
      writes.push({
        bearerType: "person",
        bearerId: selfId,
        rules: withAnswered(ownStored.map(asInput), answer.errands),
      });
  }

  const observing = new Set(
    observersOf(ctx.holiday, ctx.stored, ctx.implicit).map((o) =>
      bearerKey(o.bearerType, o.bearerId),
    ),
  );
  for (const w of answer.wishes) {
    if (w.bearerType === "person" && w.bearerId === selfId) continue;
    const observes = observing.has(bearerKey(w.bearerType, w.bearerId));
    if (observes && wishes(ctx, w.bearerType, w.bearerId) === w.wish) continue;
    if (!observes && !w.wish) continue;
    const schedule = scheduleOf(ctx, w.bearerType, w.bearerId);
    const wish = schedule.find((r) => r.action === "wish") ?? {
      action: "wish" as const,
      label: null,
      offsetDays: 0,
      enabled: false,
    };
    writes.push({
      bearerType: w.bearerType,
      bearerId: w.bearerId,
      rules: withAnswered(schedule, [{ ...wish, enabled: w.wish }]),
    });
  }
  return writes;
}
