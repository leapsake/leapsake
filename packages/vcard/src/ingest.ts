import { type Gender, hasAnyName } from "@leapsake/schema";
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
    entityType: "person" | "pet",
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
  /** Record somebody the card named as related, as an unpublished person hanging
   *  off this one. */
  addRelated(personId: string, related: ParsedRelated): Promise<void>;
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
 * **Each contact is still resolved on its own**, which is what keeps the loop a
 * loop. The facts that need the *batch* — a `RELATED` pointing at another card
 * in the same file, and the two halves of one relationship-borne milestone —
 * need a second pass over a UID→id map, and that is `plans/export.md` → 5b.
 */
export async function ingestContacts(
  ports: ImportPorts,
  decisions: ImportDecision[],
): Promise<ImportResult> {
  let created = 0;
  let skipped = 0;
  const errors: ImportError[] = [];

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
      await ports.transaction(async () => {
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
        for (const relation of contact.related) {
          await ports.addRelated(id, relation);
        }
        // Last, and inside the same transaction, so a card that fails halfway
        // never leaves the self pointer aimed at a person who was rolled back.
        // Two cards both claiming it is a decision the review makes, not one to
        // arbitrate here: the singleton means the last one wins.
        if (contact.isSelf && !pet) await ports.setSelf(id);
      });
      created++;
    } catch (err) {
      errors.push({
        index,
        contact,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, skipped, errors };
}
