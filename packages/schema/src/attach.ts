import type { MilestoneKind } from "./milestone.js";
import { fold } from "./search-fold.js";

// Whether an incoming contact is a person Leapsake already holds; the rule is
// in `@leapsake/contact-import`'s README, _Attaching a contact_.

/** A partial civil date; a field missing on either side never conflicts. */
export interface AttachDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

/** A labelled email, phone or address, its value already normalized. */
export interface LabelledValue {
  label: string;
  value: string;
}

/** One side of the comparison: an incoming contact or a stored person, with
 *  values normalized by the caller exactly as on the other side. */
export interface AttachFields {
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: string | null;
  birthday: AttachDate | null;
  dates: { kind: MilestoneKind; date: AttachDate }[];
  emails: LabelledValue[];
  phones: LabelledValue[];
  postals: LabelledValue[];
  handles: { platform: string; value: string }[];
}

/** Kinds a person has at most one of, so two different dates conflict;
 *  exhaustive, so a new kind fails the build here. */
const HAPPENS_ONCE: Record<MilestoneKind, boolean> = {
  birthday: true,
  death: true,
  met: true,
  "first-date": true,
  wedding: true,
  graduation: false,
  "job-start": false,
  moved: false,
  other: false,
};

const foldName = (s: string | null): string =>
  fold(s ?? "")
    .replace(/\s+/g, " ")
    .trim();

/** A label as a grouping key: case and spacing ignored, and `""` for one that
 *  groups nothing ("Other", or none). */
function labelKey(label: string): string {
  const key = fold(label).replace(/\s+/g, "");
  return key === "other" ? "" : key;
}

function fullName(f: AttachFields): string {
  return [foldName(f.firstName), foldName(f.lastName)]
    .filter((part) => part !== "")
    .join(" ");
}

function bothDiffer<T>(a: T | null, b: T | null): boolean {
  return a !== null && b !== null && a !== b;
}

function datesConflict(a: AttachDate, b: AttachDate): boolean {
  return (
    bothDiffer(a.year, b.year) ||
    bothDiffer(a.month, b.month) ||
    bothDiffer(a.day, b.day)
  );
}

function groupByKey(
  entries: readonly { key: string; value: string }[],
): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>();
  for (const { key, value } of entries) {
    if (key === "") continue;
    const group = groups.get(key) ?? new Set<string>();
    group.add(value);
    groups.set(key, group);
  }
  return groups;
}

/** Whether some key both sides use shares no value under it. */
function listsConflict(
  a: readonly { key: string; value: string }[],
  b: readonly { key: string; value: string }[],
): boolean {
  const bGroups = groupByKey(b);
  for (const [key, aValues] of groupByKey(a)) {
    const bValues = bGroups.get(key);
    if (bValues && ![...aValues].some((v) => bValues.has(v))) return true;
  }
  return false;
}

const byLabel = (list: readonly LabelledValue[]) =>
  list.map((e) => ({ key: labelKey(e.label), value: e.value }));

const byPlatform = (list: AttachFields["handles"]) =>
  list.map((h) => ({ key: fold(h.platform), value: h.value }));

function compatible(a: AttachFields, b: AttachFields): boolean {
  if (
    bothDiffer(foldName(a.middleName) || null, foldName(b.middleName) || null)
  )
    return false;
  if (bothDiffer(a.gender, b.gender)) return false;
  if (a.birthday && b.birthday && datesConflict(a.birthday, b.birthday))
    return false;
  for (const x of a.dates) {
    if (!HAPPENS_ONCE[x.kind]) continue;
    for (const y of b.dates) {
      if (y.kind === x.kind && datesConflict(x.date, y.date)) return false;
    }
  }
  return !(
    listsConflict(byLabel(a.emails), byLabel(b.emails)) ||
    listsConflict(byLabel(a.phones), byLabel(b.phones)) ||
    listsConflict(byLabel(a.postals), byLabel(b.postals)) ||
    listsConflict(byPlatform(a.handles), byPlatform(b.handles))
  );
}

const shares = (a: readonly string[], b: readonly string[]): boolean =>
  a.some((v) => b.includes(v));

/** A shared email, phone, handle, or a birthday whose month and day agree. */
function sharesAValue(a: AttachFields, b: AttachFields): boolean {
  const handle = (h: AttachFields["handles"][number]) =>
    `${fold(h.platform)}\u0000${h.value}`;
  return (
    shares(
      a.emails.map((e) => e.value),
      b.emails.map((e) => e.value),
    ) ||
    shares(
      a.phones.map((p) => p.value),
      b.phones.map((p) => p.value),
    ) ||
    shares(a.handles.map(handle), b.handles.map(handle)) ||
    (a.birthday?.month != null &&
      a.birthday.day != null &&
      a.birthday.month === b.birthday?.month &&
      a.birthday.day === b.birthday.day)
  );
}

/** Whether `contact` is `person`: the same full name, one more shared value,
 *  and nothing either says that contradicts the other. */
export function canAttach(
  contact: AttachFields,
  person: AttachFields,
): boolean {
  const name = fullName(contact);
  return (
    name !== "" &&
    name === fullName(person) &&
    sharesAValue(contact, person) &&
    compatible(contact, person)
  );
}

/** The one person `contact` can attach to, or `null` when none or several
 *  can, since several are themselves duplicates for the review. */
export function attachTarget<P extends { fields: AttachFields }>(
  contact: AttachFields,
  people: readonly P[],
): P | null {
  let target: P | null = null;
  for (const person of people) {
    if (!canAttach(contact, person.fields)) continue;
    if (target !== null) return null;
    target = person;
  }
  return target;
}
