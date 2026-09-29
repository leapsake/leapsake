import {
  type EntityType,
  type Gender,
  type MilestoneBearerType,
  type MilestoneKind,
  hasAnyName,
  kindAllowsBearer,
} from "@leapsake/schema";
import type {
  ParsedBirthday,
  ParsedContact,
  ParsedDate,
  ParsedEmail,
  ParsedName,
  ParsedPhone,
  ParsedPostal,
  ParsedSocial,
  ParsedRelated,
} from "./parsed-contact.js";
import { nameInputFrom } from "./parsed-contact.js";

/** The repo writes the ingest engine drives; wire them over raw repos, since
 *  the driver's transactions don't nest. */
export interface ImportPorts {
  /** Creates the person and returns its id; put the name through
   *  {@link nameInputFrom}, as blanks arrive as `""`. */
  createPerson(
    name: ParsedName,
    gender: Gender | null,
  ): Promise<{ id: string }>;
  /** Creates the pet a `KIND:x-pet` card is about, from its first-name slot,
   *  and returns its id. */
  createPet(name: ParsedName, gender: Gender | null): Promise<{ id: string }>;
  /** Applies the card's `CATEGORIES` as tags, by name. */
  addTags(
    entityType: EntityType,
    entityId: string,
    names: string[],
  ): Promise<void>;
  addEmail(personId: string, email: ParsedEmail): Promise<void>;
  addPhone(personId: string, phone: ParsedPhone): Promise<void>;
  addPostal(personId: string, postal: ParsedPostal): Promise<void>;
  addSocial(personId: string, social: ParsedSocial): Promise<void>;
  /** Records the birthday; ⚠️ a pet passed as `"person"` commits silently to a
   *  bearer nobody lists, so the type must travel. */
  addBirthday(
    bearerType: EntityType,
    bearerId: string,
    birthday: ParsedBirthday,
  ): Promise<void>;
  /** Records another dated occasion on any bearer, relationships included; the
   *  engine has checked {@link kindAllowsBearer}. */
  addDate(
    bearerType: MilestoneBearerType,
    bearerId: string,
    date: ParsedDate,
  ): Promise<void>;
  /** Records somebody the card only named, as an unpublished person related
   *  to this entity. */
  addRelated(
    ownerType: EntityType,
    ownerId: string,
    related: ParsedRelated,
  ): Promise<void>;
  /** Joins two entities with cards in this batch, once per edge; returns the
   *  new row's id, which phase 2 maps the file's id to. */
  linkExisting(
    ownerType: EntityType,
    ownerId: string,
    otherType: EntityType,
    otherId: string,
    related: ParsedRelated,
  ): Promise<{ id: string }>;
  /** Points `self_person` at this person, on the user's answer in review. */
  setSelf(personId: string): Promise<void>;
  /** Remembers an address-book record as imported, or with `null` as left
   *  out, so it is never imported twice. */
  linkSource(
    sourceId: string,
    entity: { type: EntityType; id: string } | null,
  ): Promise<void>;
  /** Runs one contact's writes atomically. */
  transaction<T>(body: () => Promise<T>): Promise<T>;
}

/** Import or skip one contact, carrying the contact as the user reviewed it. */
export interface ImportDecision {
  action: "create" | "skip";
  contact: ParsedContact;
  /** The address-book record this came from, if any; a nameless one is then
   *  remembered and skipped rather than refused. */
  sourceId?: string;
}

/** One contact that could not be imported, listed in the summary. */
export interface ImportError {
  index: number;
  contact: ParsedContact;
  message: string;
}

/** What an import run did: landed, skipped, and why any failed. */
export interface ImportResult {
  created: number;
  skipped: number;
  errors: ImportError[];
}

/**
 * Imports the chosen contacts, each in its own transaction, collecting errors
 * rather than throwing; see the README's _How an import fails_.
 */
export async function ingestContacts(
  ports: ImportPorts,
  decisions: ImportDecision[],
): Promise<ImportResult> {
  let created = 0;
  let skipped = 0;
  const errors: ImportError[] = [];
  /** Every entity this run created, by the `UID` its card carried. */
  const byUid = new Map<string, { type: EntityType; id: string }>();
  /** Edges pointing at another card, held until phase 2. */
  const pending: {
    index: number;
    contact: ParsedContact;
    ownerType: EntityType;
    ownerId: string;
    relation: ParsedRelated;
  }[] = [];
  /** Milestones a relationship bears, held until that edge is written. */
  const pendingDates: {
    index: number;
    contact: ParsedContact;
    ownerType: EntityType;
    ownerId: string;
    date: ParsedDate;
  }[] = [];

  for (let index = 0; index < decisions.length; index++) {
    const { action, contact, sourceId } = decisions[index];
    if (action === "skip") {
      skipped++;
      continue;
    }

    // Any one name part is enough; only a card with none is refused.
    if (!hasAnyName(nameInputFrom(contact.name))) {
      // From an address book that is nearly always a business: remember it.
      if (sourceId !== undefined) {
        try {
          await ports.linkSource(sourceId, null);
          skipped++;
        } catch (err) {
          errors.push({
            index,
            contact,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }
      errors.push({
        index,
        contact,
        message: "Needs a name before it can be imported",
      });
      continue;
    }

    // Held until this card commits, so a rollback leaves phase 2 nothing.
    const refused: MilestoneKind[] = [];
    const heldEdges: ParsedRelated[] = [];
    const heldDates: ParsedDate[] = [];
    try {
      const landed = await ports.transaction(async () => {
        // A pet differs only in having no contact methods.
        const pet = contact.kind === "pet";
        const { id } = pet
          ? await ports.createPet(contact.name, contact.gender)
          : await ports.createPerson(contact.name, contact.gender);

        if (contact.tags.length > 0) {
          await ports.addTags(pet ? "pet" : "person", id, contact.tags);
        }
        if (!pet) {
          for (const email of contact.emails) await ports.addEmail(id, email);
          for (const phone of contact.phones) await ports.addPhone(id, phone);
          for (const postal of contact.postals) {
            await ports.addPostal(id, postal);
          }
          for (const social of contact.socials) {
            await ports.addSocial(id, social);
          }
        }
        const ownerType: EntityType = pet ? "pet" : "person";
        if (contact.birthday) {
          await ports.addBirthday(ownerType, id, contact.birthday);
        }
        for (const date of contact.dates) {
          // A relationship's milestone waits for its edge; a `-REL` on a kind
          // no relationship holds falls back to the entity.
          if (
            date.relationshipId !== null &&
            kindAllowsBearer(date.kind, "relationship")
          ) {
            heldDates.push(date);
            continue;
          }
          // ⚠️ Refused here, or the schema's throw would roll back the whole
          // card; reported only once the card commits.
          if (!kindAllowsBearer(date.kind, ownerType)) {
            refused.push(date.kind);
            continue;
          }
          await ports.addDate(ownerType, id, date);
        }

        for (const relation of contact.related) {
          // A named relation has no card of its own, so it is written here.
          if (relation.otherUid === null) {
            await ports.addRelated(ownerType, id, relation);
          } else {
            heldEdges.push(relation);
          }
        }
        // Last and inside the transaction, so a rollback never leaves the
        // pointer aimed at nobody.
        if (contact.isSelf && !pet) await ports.setSelf(id);
        // A contact that rolls back must not be remembered as imported.
        if (sourceId !== undefined) {
          await ports.linkSource(sourceId, { type: ownerType, id });
        }
        return { type: ownerType, id };
      });
      // Only once committed, so phase 2 never points at a rolled-back entity.
      if (contact.uid !== null) byUid.set(contact.uid, landed);
      created++;
      const owner = {
        index,
        contact,
        ownerType: landed.type,
        ownerId: landed.id,
      };
      for (const relation of heldEdges) pending.push({ ...owner, relation });
      for (const date of heldDates) pendingDates.push({ ...owner, date });
      for (const kind of refused) {
        errors.push({
          index,
          contact,
          message: `Skipped a milestone a ${landed.type} cannot hold: ${kind}`,
        });
      }
    } catch (err) {
      errors.push({
        index,
        contact,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Phase 2a: edges between cards, each in its own transaction.
  const written = new Set<string>();
  /** The file's `relationships.id` to the row this import created for it. */
  const relIdByFileId = new Map<string, string>();
  for (const edge of pending) {
    const key = edgeKey(edge.contact.uid, edge.relation);
    if (written.has(key)) continue;
    written.add(key);

    const other = byUid.get(edge.relation.otherUid ?? "");
    try {
      await ports.transaction(async () => {
        if (other === undefined) {
          // The other card was skipped or failed, so this lands as a named
          // relation, and stays out of `relIdByFileId`.
          await ports.addRelated(edge.ownerType, edge.ownerId, edge.relation);
        } else {
          const row = await ports.linkExisting(
            edge.ownerType,
            edge.ownerId,
            other.type,
            other.id,
            edge.relation,
          );
          if (edge.relation.relationshipId !== null) {
            relIdByFileId.set(edge.relation.relationshipId, row.id);
          }
        }
      });
    } catch (err) {
      // Attributed to the card that carried the edge, already counted.
      errors.push({
        index: edge.index,
        contact: edge.contact,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Phase 2b: the milestones those edges bear, each in its own transaction.
  const writtenDates = new Set<string>();
  for (const entry of pendingDates) {
    const key = milestoneKey(entry.date);
    if (writtenDates.has(key)) continue;
    writtenDates.add(key);

    const relId =
      entry.date.relationshipId === null
        ? undefined
        : relIdByFileId.get(entry.date.relationshipId);
    try {
      await ports.transaction(async () => {
        if (relId !== undefined) {
          await ports.addDate("relationship", relId, entry.date);
          return;
        }
        // With no edge to hang it on, it lands once on this entity instead.
        if (!kindAllowsBearer(entry.date.kind, entry.ownerType)) return;
        await ports.addDate(entry.ownerType, entry.ownerId, entry.date);
      });
    } catch (err) {
      errors.push({
        index: entry.index,
        contact: entry.contact,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, skipped, errors };
}

/** What makes two `RELATED` lines one edge: `X-LEAPSAKE-REL-ID`, else the
 *  unordered pair of uids, never the role, which inverts. */
function edgeKey(ownerUid: string | null, relation: ParsedRelated): string {
  if (relation.relationshipId !== null) return `rel:${relation.relationshipId}`;
  const pair = [ownerUid ?? "", relation.otherUid ?? ""].sort();
  return `pair:${pair[0]}|${pair[1]}`;
}

/** What makes two `X-ABDATE` lines one milestone: its id, else its edge, kind
 *  and date. */
function milestoneKey(date: ParsedDate): string {
  if (date.id !== null) return `mst:${date.id}`;
  const { year, month, day } = date.date;
  return `rel:${date.relationshipId}|${date.kind}|${year}-${month}-${day}`;
}
