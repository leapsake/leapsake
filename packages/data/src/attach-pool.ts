import {
  type AttachFields,
  type LabelledValue,
  type MilestoneKind,
  PUBLISHED_SQL,
  attachNameKey,
  attachTarget,
  foldAddress,
  normalizeEmail,
  normalizeHandle,
  normalizePhone,
} from "@leapsake/schema";
import { phoneE164 } from "@leapsake/phone";
import type { SqliteDriver } from "./driver.js";

/** The people an import's contacts may attach to, loaded once per import and
 *  kept current as contacts land. Values go in raw and are normalized here. */
export interface AttachPool {
  /** The one person `contact` is, or `null`; see `attachTarget`. */
  target(contact: AttachFields): string | null;
  /** Records what a person now holds, so later contacts compare against it. */
  landed(personId: string, contact: AttachFields): void;
  /** What the pool holds for a person, normalized. */
  known(personId: string): AttachFields | undefined;
  /** `fields` with every value normalized as the pool's are. */
  normalize(fields: AttachFields): AttachFields;
}

/** A postal address as one comparable string; any part may be absent. */
export function postalValue(parts: readonly (string | null)[]): string {
  return parts.filter((p) => p !== null && p !== "").join(" ");
}

interface PersonRow {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  gender: string | null;
}
interface LabelledRow {
  owner_id: string;
  label: string;
  value: string;
}
interface PostalRow {
  owner_id: string;
  label: string;
  line1: string | null;
  line2: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
}
interface SocialRow {
  owner_id: string;
  platform: string;
  handle: string;
}
interface MilestoneRow {
  owner_id: string;
  kind: MilestoneKind;
  year: number | null;
  month: number | null;
  day: number | null;
}

const ACTIVE_OWNED = "deleted_at IS NULL AND owner_type = 'person'";

function groupBy<R extends { owner_id: string }>(
  rows: readonly R[],
): Map<string, R[]> {
  const by = new Map<string, R[]>();
  for (const row of rows) {
    const list = by.get(row.owner_id) ?? [];
    list.push(row);
    by.set(row.owner_id, list);
  }
  return by;
}

export async function loadAttachPool(
  driver: SqliteDriver,
  options: { phoneRegion?: string | null } = {},
): Promise<AttachPool> {
  const phoneKey = (raw: string): string =>
    phoneE164(raw, options.phoneRegion) || normalizePhone(raw);

  const each = (list: LabelledValue[], key: (v: string) => string) =>
    list.map((e) => ({ label: e.label, value: key(e.value) }));

  function normalize(f: AttachFields): AttachFields {
    return {
      ...f,
      emails: each(f.emails, normalizeEmail),
      phones: each(f.phones, phoneKey),
      postals: each(f.postals, foldAddress),
      handles: f.handles.map((h) => ({
        platform: h.platform,
        value: normalizeHandle(h.value),
      })),
    };
  }

  const [people, emails, phones, postals, socials, milestones] =
    await Promise.all([
      driver.all<PersonRow>(
        `SELECT id, first_name, middle_name, last_name, gender FROM people
          WHERE deleted_at IS NULL AND ${PUBLISHED_SQL}`,
      ),
      driver.all<LabelledRow>(
        `SELECT owner_id, label, address AS value FROM email_addresses
          WHERE ${ACTIVE_OWNED}`,
      ),
      driver.all<LabelledRow>(
        `SELECT owner_id, label, number AS value FROM phone_numbers
          WHERE ${ACTIVE_OWNED}`,
      ),
      driver.all<PostalRow>(
        `SELECT owner_id, label, line1, line2, locality, region, postal_code,
                country
           FROM postal_addresses WHERE ${ACTIVE_OWNED}`,
      ),
      driver.all<SocialRow>(
        `SELECT owner_id, platform, handle FROM social_profiles
          WHERE ${ACTIVE_OWNED}`,
      ),
      driver.all<MilestoneRow>(
        `SELECT bearer_id AS owner_id, kind, year, month, day
           FROM milestones
          WHERE deleted_at IS NULL AND bearer_type = 'person'`,
      ),
    ]);

  const emailsBy = groupBy(emails);
  const phonesBy = groupBy(phones);
  const postalsBy = groupBy(postals);
  const socialsBy = groupBy(socials);
  const milestonesBy = groupBy(milestones);

  const pool = new Map<string, AttachFields>();
  /** Person ids by name key, since only a namesake can qualify. */
  const byName = new Map<string, string[]>();
  function put(personId: string, fields: AttachFields): void {
    if (!pool.has(personId)) {
      const key = attachNameKey(fields);
      byName.set(key, [...(byName.get(key) ?? []), personId]);
    }
    pool.set(personId, fields);
  }
  for (const p of people) {
    const dated = milestonesBy.get(p.id) ?? [];
    const birthday = dated.find((m) => m.kind === "birthday");
    put(
      p.id,
      normalize({
        firstName: p.first_name ?? "",
        middleName: p.middle_name,
        lastName: p.last_name ?? "",
        gender: p.gender,
        birthday: birthday
          ? { year: birthday.year, month: birthday.month, day: birthday.day }
          : null,
        dates: dated
          .filter((m) => m.kind !== "birthday")
          .map((m) => ({
            kind: m.kind,
            date: { year: m.year, month: m.month, day: m.day },
          })),
        emails: (emailsBy.get(p.id) ?? []).map(({ label, value }) => ({
          label,
          value,
        })),
        phones: (phonesBy.get(p.id) ?? []).map(({ label, value }) => ({
          label,
          value,
        })),
        postals: (postalsBy.get(p.id) ?? []).map((a) => ({
          label: a.label,
          value: postalValue([
            a.line1,
            a.line2,
            a.locality,
            a.region,
            a.postal_code,
            a.country,
          ]),
        })),
        handles: (socialsBy.get(p.id) ?? []).map((s) => ({
          platform: s.platform,
          value: s.handle,
        })),
      }),
    );
  }

  return {
    target(contact) {
      const people = (byName.get(attachNameKey(contact)) ?? []).map((id) => ({
        id,
        fields: pool.get(id) as AttachFields,
      }));
      return attachTarget(normalize(contact), people)?.id ?? null;
    },
    landed(personId, contact) {
      const added = normalize(contact);
      const had = pool.get(personId);
      put(
        personId,
        had === undefined
          ? added
          : {
              ...had,
              middleName: had.middleName ?? added.middleName,
              gender: had.gender ?? added.gender,
              birthday: had.birthday ?? added.birthday,
              dates: [...had.dates, ...added.dates],
              emails: [...had.emails, ...added.emails],
              phones: [...had.phones, ...added.phones],
              postals: [...had.postals, ...added.postals],
              handles: [...had.handles, ...added.handles],
            },
      );
    },
    known: (personId) => pool.get(personId),
    normalize,
  };
}
