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
  /**
   * Record the card's birthday as a `birthday`-kind milestone.
   *
   * Takes the bearer's **type** for the same reason {@link ImportPorts.addRelated}
   * does: a pet's card carries a birthday, and a milestone row names the type of
   * whatever bears it. Unlike a relationship, passing `"person"` for a pet here
   * does **not** fail loudly — `kindAllowsBearer("birthday", "person")` is true,
   * so the row commits against a `bearer_id` no person has and
   * `listForBearer("pet", …)` never finds it again. Hence the type travels.
   */
  addBirthday(
    bearerType: EntityType,
    bearerId: string,
    birthday: ParsedBirthday,
  ): Promise<void>;
  /**
   * Record a dated occasion other than the birthday, as a milestone of the kind
   * the card carried outright (`X-LEAPSAKE-MILESTONE-KIND`) or, for a foreign
   * card, the one the parser resolved from its label.
   *
   * The bearer is a full {@link MilestoneBearerType} rather than an
   * {@link EntityType}, because a wedding belongs to the **marriage** rather than
   * to either partner — one port serves both the entity-borne milestones written
   * inside a contact's own transaction and the relationship-borne ones the engine
   * defers until every edge exists.
   *
   * The engine has already checked {@link kindAllowsBearer}, so this never has to.
   */
  addDate(
    bearerType: MilestoneBearerType,
    bearerId: string,
    date: ParsedDate,
  ): Promise<void>;
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
   *
   * **Returns the new row's id**, which the file cannot supply: a milestone borne
   * by this edge names it as the `relationships.id` it had *in the file*, and the
   * import mints a fresh one. Phase 2 builds the map between the two out of these
   * return values, and a milestone that cannot be looked up through it would
   * otherwise point at a row that does not exist.
   */
  linkExisting(
    ownerType: EntityType,
    ownerId: string,
    otherType: EntityType,
    otherId: string,
    related: ParsedRelated,
  ): Promise<{ id: string }>;
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
  /**
   * Remember that the address-book record `sourceId` has been brought in as
   * `entity` — or, for `null`, seen and deliberately left out — so that keeping
   * People in step with that address book never imports it a second time.
   *
   * Called only for a decision that carries a {@link ImportDecision.sourceId}.
   * For an entity that landed it runs **inside** the contact's transaction, so a
   * contact that rolls back is not remembered, and an implementor that refuses a
   * second link for one id rolls the duplicate back instead of landing it.
   */
  linkSource(
    sourceId: string,
    entity: { type: EntityType; id: string } | null,
  ): Promise<void>;
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
  /**
   * The address-book record this contact was read from, when it came from one
   * that can be read again (the phone's contacts, not a dropped file). Present,
   * it is handed to {@link ImportPorts.linkSource}, and a contact with no name at
   * all is remembered as seen and counted as skipped rather than refused — the
   * next read of the address book would otherwise refuse it again, every time.
   */
  sourceId?: string;
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
 *
 * **A relationship-borne milestone is the same shape one level down**, and rides
 * the same two phases. A wedding belongs to the marriage rather than to either
 * partner, so it is written on **both** cards with one
 * `X-LEAPSAKE-MILESTONE-ID`; without dedupe on it, importing a couple gives them
 * two weddings. It also cannot be written while its card is being built — the
 * edge does not exist yet — so phase 2 writes the edges first, keeps the map from
 * each file `relationships.id` to the row it actually created, and only then
 * writes the milestones that hang off them. A milestone the entity bears itself
 * is nobody else's business and stays in phase 1.
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
  /** Milestones a *relationship* bears, held until that edge has been written. */
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

    // A card needs *some* name, not a first and a last one — which is what the
    // parser was already saying by leaving `lastName` empty for a mononym or an
    // organisation-only card rather than inventing one. Until `personSchema`
    // allowed that, every such card was refused here; now only a card with no
    // name at all is (an `FN`-less vCard, which carries nothing to file it by).
    if (!hasAnyName(nameInputFrom(contact.name))) {
      // From an address book, that is nearly always a business, and nobody is
      // there to type a name in: remember it as seen and move on.
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

    // What this card leaves for later, held locally until it has committed —
    // for exactly the reason `byUid` is: a card that rolls back must leave phase
    // 2 nothing to point at, and an entity id from an aborted transaction names
    // no row at all. Milestones its own bearer may not hold ride along, so the
    // error is reported only if there is a card to report it against.
    const refused: MilestoneKind[] = [];
    const heldEdges: ParsedRelated[] = [];
    const heldDates: ParsedDate[] = [];
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
        const ownerType: EntityType = pet ? "pet" : "person";
        if (contact.birthday) {
          await ports.addBirthday(ownerType, id, contact.birthday);
        }
        for (const date of contact.dates) {
          // A milestone the *relationship* bears waits for phase 2, because the
          // edge it names does not exist yet. Only those wait: everything else
          // is this card's own business and belongs in this transaction.
          //
          // A `-REL` on a kind no relationship may hold is a malformed card, so
          // the entity takes it back rather than the row being refused.
          if (
            date.relationshipId !== null &&
            kindAllowsBearer(date.kind, "relationship")
          ) {
            heldDates.push(date);
            continue;
          }
          // ⚠️ The bearer decides which kinds are even possible — a pet has no
          // anniversary, and `milestoneSchema` refuses the row outright. Refusing
          // it *here* costs one milestone; letting it throw would roll back the
          // whole card, taking the pet's name, tags and relations with it. The
          // error is pushed after the transaction commits, below, so a card that
          // rolls back for some other reason leaves no phantom behind.
          if (!kindAllowsBearer(date.kind, ownerType)) {
            refused.push(date.kind);
            continue;
          }
          await ports.addDate(ownerType, id, date);
        }

        for (const relation of contact.related) {
          // A *named* relation is entirely this card's business — the person it
          // names has no card, so nothing else in the batch can contribute to
          // it — and it stays inside this contact's transaction.
          if (relation.otherUid === null) {
            await ports.addRelated(ownerType, id, relation);
          } else {
            heldEdges.push(relation);
          }
        }
        // Last, and inside the same transaction, so a card that fails halfway
        // never leaves the self pointer aimed at a person who was rolled back.
        // Two cards both claiming it is a decision the review makes, not one to
        // arbitrate here: the singleton means the last one wins.
        if (contact.isSelf && !pet) await ports.setSelf(id);
        // Same reasoning: a contact that rolls back must not be remembered as
        // brought in, or the next read of its address book would skip it.
        if (sourceId !== undefined) {
          await ports.linkSource(sourceId, { type: ownerType, id });
        }
        return { type: ownerType, id };
      });
      // Only after the transaction has committed: an entity whose write rolled
      // back must not be something phase 2 can point an edge at.
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

  // Phase 2a — the edges that needed the whole batch to exist first. Each in its
  // own transaction, for the same reason a contact gets one: an edge that
  // cannot be written must cost only itself.
  const written = new Set<string>();
  /**
   * The file's `relationships.id` → the id of the row this import actually
   * created for it. A relationship-borne milestone names the former and has to
   * be written against the latter; using the file's value raw would point every
   * such milestone at a row that does not exist.
   */
  const relIdByFileId = new Map<string, string>();
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
          //
          // Deliberately **not** recorded in `relIdByFileId`: a milestone whose
          // edge degraded this way lands on the entity instead (see below). The
          // edge here is a stub between a real person and an invented one, and
          // binding a wedding to it would say the marriage survived the skip
          // when what survived is only the spouse's name.
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

  // Phase 2b — the milestones those edges bear, once every edge exists. Same
  // one-transaction-each rule, and the same attribution: the card that carried
  // the milestone is already counted in `created`, so a failure here reads as
  // "imported, but this one date did not".
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
        // No edge to hang it on: the other card was skipped, so the relationship
        // degraded to a stub, or the file names an edge it does not contain. The
        // date is still a fact about this person, so it lands on **them** rather
        // than being dropped — a wedding on Jane instead of on the marriage,
        // which the user can rebind if the other half ever arrives.
        //
        // The dedupe above means it lands once, on whichever card was built
        // first, rather than on both partners: it is still one fact.
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

/**
 * What makes two `X-ABDATE` lines the *same* milestone — {@link edgeKey} one
 * level down, and for the same reason. A wedding is borne by the marriage, so it
 * is written on both partners' cards; `X-LEAPSAKE-MILESTONE-ID` is what says the
 * two lines are one fact rather than two weddings.
 *
 * Without an id there is no second identifier to fall back on the way an edge
 * has the pair of uids — a milestone names only the edge it hangs off. The edge,
 * its kind and its date are the most that can be known, and two distinct
 * milestones agreeing on all three are indistinguishable anyway.
 */
function milestoneKey(date: ParsedDate): string {
  if (date.id !== null) return `mst:${date.id}`;
  const { year, month, day } = date.date;
  return `rel:${date.relationshipId}|${date.kind}|${year}-${month}-${day}`;
}
