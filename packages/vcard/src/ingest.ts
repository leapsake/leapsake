import { type EntityType, type Gender, hasAnyName } from "@leapsake/schema";
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

/**
 * The write surface the ingest engine drives — the narrow slice of Leapsake's
 * repos it needs, injected so the engine unit-tests against an in-memory fake
 * with no sqlite driver (mirroring `@leapsake/reminders`). The composition root
 * (`@leapsake/core`) wires these over its **raw repos** inside a single
 * `transaction`, deliberately *not* the transaction-wrapping core methods (the
 * driver's BEGIN/COMMIT doesn't nest), and reconciles birthday reminders once
 * after the whole batch.
 */
export interface ImportPorts {
  /** Create the person and return its new id. The engine has already checked
   *  there is at least one name part, so the port never has to fabricate one —
   *  but a part the card left blank still arrives as `""`, and the implementor
   *  is expected to put the name through {@link nameInputFrom} to spell that
   *  the way the Person schema does. */
  createPerson(
    name: ParsedName,
    gender: Gender | null,
  ): Promise<{ id: string }>;
  /**
   * Create the pet a `KIND:x-pet` card is about, and return its new id.
   *
   * A port of its own rather than a flag on {@link ImportPorts.createPerson},
   * because the two write different tables — and because the *export* side has
   * long had the matching split (`toPetContact` beside `toExportContact`), so a
   * flag here would be the odd one out.
   *
   * A pet has only a name and a gender: `petSchema` carries nothing else, and a
   * contact method's owner is a person or a household, so there is no fan-out
   * for the engine to forget. The name is the mononym shape both sides already
   * accept — the card's first-name slot, with the surname left empty.
   */
  createPet(name: ParsedName, gender: Gender | null): Promise<{ id: string }>;
  /**
   * Apply the card's `CATEGORIES` as the entity's tags.
   *
   * Takes the entity type because a pet is tagged exactly as a person is, and
   * takes **names** rather than ids because that is all a card carries and all
   * the underlying `setEntityTags` wants — it resolves or creates each tag
   * itself.
   */
  addTags(
    entityType: EntityType,
    entityId: string,
    names: string[],
  ): Promise<void>;
  addEmail(personId: string, email: ParsedEmail): Promise<void>;
  addPhone(personId: string, phone: ParsedPhone): Promise<void>;
  addPostal(personId: string, postal: ParsedPostal): Promise<void>;
  addSocial(personId: string, social: ParsedSocial): Promise<void>;
  addBirthday(personId: string, birthday: ParsedBirthday): Promise<void>;
  /** Record a dated occasion other than the birthday (an anniversary), as a
   *  milestone of the kind the parser resolved from the source's own label. */
  addDate(personId: string, date: ParsedDate): Promise<void>;
  /**
   * Record somebody the card merely *named* as related, as an unpublished person
   * hanging off this entity.
   *
   * Takes the owner's **type** because a pet's card carries relations too, and a
   * relationship row names the type of each of its two ends. Passing `"person"`
   * for a pet does not write a wrong row quietly — `holderAllows` refuses it and
   * the whole contact fails — so the type has to travel with the id.
   */
  addRelated(
    ownerType: EntityType,
    ownerId: string,
    related: ParsedRelated,
  ): Promise<void>;
  /**
   * Join two entities that **both** have cards in this batch — the reciprocal of
   * {@link ImportPorts.addRelated}, for a `RELATED` that pointed at another card
   * rather than naming somebody.
   *
   * The engine calls this exactly once per edge, having already resolved both
   * ends and discarded the duplicate half; the implementor writes one
   * relationship row and nothing else.
   */
  linkExisting(
    ownerType: EntityType,
    ownerId: string,
    otherType: EntityType,
    otherId: string,
    related: ParsedRelated,
  ): Promise<void>;
  /**
   * Point the `self_person` singleton at this person — the user saying "this
   * card is me".
   *
   * Driven by {@link ParsedContact.isSelf} on the contact that comes *back* from
   * the review, which is the user's decision rather than the card's claim: the
   * review starts every such card opted **out**, so importing somebody else's
   * export can never silently reassign who "me" is. See `plans/export.md` → 5a.
   */
  setSelf(personId: string): Promise<void>;
  /** Run one contact's writes atomically (the real driver's `transaction`). */
  transaction<T>(body: () => Promise<T>): Promise<T>;
}

/**
 * The user's per-contact call from the review screen: import this contact or skip
 * it. The `contact` travels back with the decision (edited names and all) so the
 * commit works off exactly what the user reviewed.
 */
export interface ImportDecision {
  action: "create" | "skip";
  contact: ParsedContact;
}

/** One contact that could not be imported, kept so the summary can list it
 *  without aborting the rest of the batch. */
export interface ImportError {
  index: number;
  contact: ParsedContact;
  message: string;
}

/** What an import run did: how many landed, how many were skipped, and why any
 *  failed. */
export interface ImportResult {
  created: number;
  skipped: number;
  errors: ImportError[];
}

/**
 * Create the chosen contacts, **each in its own transaction** so one bad contact
 * rolls back only itself and the rest still import. A `skip` decision is counted
 * and untouched. A contact whose first or last name is empty (the mononym /
 * organisation-only card the parser left incomplete) is refused with a friendly
 * error rather than having a name invented for it — in practice the review UI
 * makes the user fill it in first, so these arrive already valid. Per-contact
 * failures are collected into {@link ImportResult.errors}; the run never throws
 * for a single bad row.
 *
 * **Two phases, because one fact can span two cards.** A `RELATED` pointing at
 * another card by `UID` cannot be written while building the card that carries
 * it — the other end may not exist yet, and the *same edge is written on both
 * cards*, so writing it from each would make two relationships out of one. So
 * phase 1 builds every entity (each in its own transaction, as before) and sets
 * such edges aside; phase 2 writes them once each, now that every id is known.
 *
 * The dedupe key is `X-LEAPSAKE-REL-ID`, which exists for exactly this — it is
 * what says "one fact written twice" rather than "two facts". A foreign card
 * with a `urn:uuid:` reference and no such id falls back to the pair of uids,
 * which is the most that can be known without one.
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

  for (let index = 0; index < decisions.length; index++) {
    const { action, contact } = decisions[index];
    if (action === "skip") {
      skipped++;
      continue;
    }

    // A card needs *some* name, not a first and a last one — which is what the
    // parser was already saying by leaving `lastName` empty for a mononym or an
    // organisation-only card rather than inventing one. Until `personSchema`
    // allowed that, every such card was refused here; now only a card with no
    // name at all is (an `FN`-less vCard, which carries nothing to file it by).
    if (!hasAnyName(nameInputFrom(contact.name))) {
      errors.push({
        index,
        contact,
        message: "Needs a name before it can be imported",
      });
      continue;
    }

    try {
      const landed = await ports.transaction(async () => {
        // A pet and a person diverge here and nowhere else. `petSchema` is only
        // a name and a gender, and a pet has no contact methods by construction
        // — but it bears milestones and relationships exactly as a person does,
        // which is why only the contact-method fan-out is skipped rather than
        // the whole tail.
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
        if (contact.birthday) await ports.addBirthday(id, contact.birthday);
        for (const date of contact.dates) await ports.addDate(id, date);

        const ownerType: EntityType = pet ? "pet" : "person";
        for (const relation of contact.related) {
          // A *named* relation is entirely this card's business — the person it
          // names has no card, so nothing else in the batch can contribute to
          // it — and it stays inside this contact's transaction.
          if (relation.otherUid === null) {
            await ports.addRelated(ownerType, id, relation);
          } else {
            pending.push({ index, contact, ownerType, ownerId: id, relation });
          }
        }
        // Last, and inside the same transaction, so a card that fails halfway
        // never leaves the self pointer aimed at a person who was rolled back.
        // Two cards both claiming it is a decision the review makes, not one to
        // arbitrate here: the singleton means the last one wins.
        if (contact.isSelf && !pet) await ports.setSelf(id);
        return { type: ownerType, id };
      });
      // Only after the transaction has committed: an entity whose write rolled
      // back must not be something phase 2 can point an edge at.
      if (contact.uid !== null) byUid.set(contact.uid, landed);
      created++;
    } catch (err) {
      errors.push({
        index,
        contact,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Phase 2 — the edges that needed the whole batch to exist first. Each in its
  // own transaction, for the same reason a contact gets one: an edge that
  // cannot be written must cost only itself.
  const written = new Set<string>();
  for (const edge of pending) {
    const key = edgeKey(edge.contact.uid, edge.relation);
    if (written.has(key)) continue;
    written.add(key);

    const other = byUid.get(edge.relation.otherUid ?? "");
    try {
      await ports.transaction(async () => {
        if (other === undefined) {
          // The card this points at was skipped in the review, or failed. The
          // *fact* is still true — this person has a spouse called Jen Davis —
          // so it lands the way a merely-named relation does, using the name the
          // parser recovered from the other card. Dropping it instead would lose
          // a relationship the file plainly states.
          await ports.addRelated(edge.ownerType, edge.ownerId, edge.relation);
        } else {
          await ports.linkExisting(
            edge.ownerType,
            edge.ownerId,
            other.type,
            other.id,
            edge.relation,
          );
        }
      });
    } catch (err) {
      // Attributed to the card that carried the edge. That contact is already
      // counted in `created` — its own row landed — so this reads as "imported,
      // but this one relationship did not", which is what happened.
      errors.push({
        index: edge.index,
        contact: edge.contact,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, skipped, errors };
}

/**
 * What makes two `RELATED` lines the *same* edge.
 *
 * `X-LEAPSAKE-REL-ID` is the real answer and exists for exactly this: the edge
 * is written on both partners' cards, and the shared id is what says "one fact
 * written twice". Our own writer always emits it, so it is the key in practice.
 *
 * Without one — a foreign card that somehow references another by `urn:uuid:` —
 * all that is left is the unordered pair of uids. **The role is deliberately not
 * part of that key**, because the two halves of one edge carry *inverse* roles
 * (`mother` on one card, `son` on the other), so including it would split every
 * pair straight back into two. The cost is that two entities related in two
 * different ways collapse to one edge when neither line carries an id — the
 * safer of the two errors, and unreachable from a file we wrote.
 */
function edgeKey(ownerUid: string | null, relation: ParsedRelated): string {
  if (relation.relationshipId !== null) return `rel:${relation.relationshipId}`;
  const pair = [ownerUid ?? "", relation.otherUid ?? ""].sort();
  return `pair:${pair[0]}|${pair[1]}`;
}
