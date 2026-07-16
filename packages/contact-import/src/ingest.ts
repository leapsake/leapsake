import type { Gender } from "@leapsake/schema";
import type {
  ParsedBirthday,
  ParsedContact,
  ParsedEmail,
  ParsedName,
  ParsedPhone,
  ParsedPostal,
} from "./parsed-contact.js";

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
  /** Create the person and return its new id. Names are already guaranteed
   *  non-empty by the engine, so the port never has to fabricate one. */
  createPerson(
    name: ParsedName,
    gender: Gender | null,
  ): Promise<{ id: string }>;
  addEmail(personId: string, email: ParsedEmail): Promise<void>;
  addPhone(personId: string, phone: ParsedPhone): Promise<void>;
  addPostal(personId: string, postal: ParsedPostal): Promise<void>;
  addBirthday(personId: string, birthday: ParsedBirthday): Promise<void>;
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

    if (
      contact.name.firstName.trim() === "" ||
      contact.name.lastName.trim() === ""
    ) {
      errors.push({
        index,
        contact,
        message: "Needs a first and last name before it can be imported",
      });
      continue;
    }

    try {
      await ports.transaction(async () => {
        const { id } = await ports.createPerson(contact.name, contact.gender);
        for (const email of contact.emails) await ports.addEmail(id, email);
        for (const phone of contact.phones) await ports.addPhone(id, phone);
        for (const postal of contact.postals) await ports.addPostal(id, postal);
        if (contact.birthday) await ports.addBirthday(id, contact.birthday);
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
