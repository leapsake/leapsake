import type { CoreApi } from "@leapsake/core";
import { type EntityType, milestoneLabel } from "@leapsake/schema";
import { captureRecipientOf, giftIdeaOf } from "@leapsake/ui/headless";
import { giftDraftEmpty } from "../components/GiftFields";
import { milestoneDraftToValue } from "../components/MilestoneFields";
import {
  otherLabelOf,
  relationshipDraftToValue,
} from "../components/RelationshipFields";
import {
  type StagedMilestone,
  milestoneRowPending,
} from "../components/StagedMilestonesSection";
import { relationshipRowPending } from "../components/StagedRelationshipsSection";
import {
  type ContactFormValue,
  contactDraftToValue,
} from "../components/ContactMethodFields";
import {
  type StagedContact,
  contactRowPending,
} from "../components/StagedContactsSection";
import type { EntityFormValue } from "./entity-form";

/**
 * Write a whole entity form against the person or pet it is about — the one pass
 * that turns everything staged on {@link EntityFormSections} into database calls.
 *
 * It serves both screens, because the create screen is the same operation with an
 * empty starting point: every row that carries no saved id is a create, so an
 * `initial` of {@link emptyEntityForm} makes this "write all of it".
 *
 * **What is written is the difference**, and it is read three ways:
 *
 * - a row with no saved id is created;
 * - a row with one is updated *only if it was edited here*, so untouched rows
 *   keep their stored `updatedAt` and their stored details;
 * - an id in `initial` with no row in `value` is removed.
 *
 * **There is no rollback.** By the time this runs the entity exists (created a
 * moment ago, or long since), and abandoning the rest because a phone number
 * failed to write would throw away more than it rescued. Failures are collected
 * by name and returned; the caller names them and carries on to the detail page,
 * where whatever didn't take is one tap from being redone.
 *
 * The order is arbitrary — the sections don't depend on each other. It used to
 * have one exception, **milestones first and gifts last**, because a gift's
 * occasion could name a milestone staged on the same form and needed the id its
 * write produced; a gift names nothing but its recipient now, so the constraint
 * and the staged-key map that served it are both gone.
 */
export async function applyEntityForm(
  core: CoreApi,
  bearerType: EntityType,
  bearerId: string,
  value: EntityFormValue,
  initial: EntityFormValue,
): Promise<string[]> {
  const failed: string[] = [];
  const owner = { ownerType: "person" as const, ownerId: bearerId };

  /** Run a write, remembering what to name if it fails. */
  async function attempt(what: string, write: () => Promise<unknown>) {
    try {
      await write();
    } catch {
      failed.push(what);
    }
  }

  // ---- Milestones ---------------------------------------------------------
  for (const row of value.milestones) {
    // An empty row is the "Add milestone" tap nobody followed through on.
    if (milestoneRowPending(row)) continue;
    const { saved, edited } = row;
    const fields = milestoneDraftToValue(row.draft);
    const label = milestoneLabel(fields);
    if (saved === undefined) {
      await attempt(label, () =>
        core.milestones.create({ ...fields, bearerType, bearerId }),
      );
      continue;
    }
    if (edited === true) {
      await attempt(label, () => core.milestones.update(saved.id, fields));
    }
  }
  for (const gone of removedRows(initial.milestones, value.milestones)) {
    const id = gone.saved?.id;
    if (id === undefined) continue;
    await attempt(stagedMilestoneLabel(gone), () =>
      core.milestones.softDelete(id),
    );
  }

  // ---- Contact methods ----------------------------------------------------
  // Person-owned only; neither form stages any for a pet.
  for (const row of value.contacts) {
    // A row every one of whose editors is open has to be allowed to be empty;
    // an empty one is nothing to write.
    if (contactRowPending(row)) continue;
    const { savedId, edited } = row;
    const method = contactDraftToValue(row.draft);
    if (savedId === undefined) {
      await attempt(method.label, () => createContact(core, owner, method));
    } else if (edited === true) {
      await attempt(method.label, () => updateContact(core, savedId, method));
    }
  }
  for (const gone of removedRows(initial.contacts, value.contacts)) {
    const id = gone.savedId;
    if (id === undefined) continue;
    await attempt(gone.draft.label, () =>
      deleteContact(core, id, gone.draft.kind),
    );
  }

  // ---- Holidays -----------------------------------------------------------
  // An observance is a fact about a pair, so both directions are the same write
  // with a different answer.
  const observed = new Set(initial.holidays.map((h) => h.id));
  const staged = new Set(value.holidays.map((h) => h.id));
  for (const holiday of value.holidays) {
    if (observed.has(holiday.id)) continue;
    await attempt(holiday.name, () =>
      core.holidays.setObservers(holiday.id, [
        { bearerType, bearerId, observes: true },
      ]),
    );
  }
  for (const holiday of initial.holidays) {
    if (staged.has(holiday.id)) continue;
    await attempt(holiday.name, () =>
      core.holidays.setObservers(holiday.id, [
        { bearerType, bearerId, observes: false },
      ]),
    );
  }

  // ---- Relationships ------------------------------------------------------
  // The entity is the subject; core implies its own role from the picked other
  // role — including the branch for an other end that doesn't exist yet, which is
  // created here as a fact about the subject. So "add a pet, its owner, and the
  // owner's wife" is one pass; only relating two *published* new people still
  // takes two.
  const subject = { subjectType: bearerType, subjectId: bearerId };
  for (const row of value.relationships) {
    // An unfilled row is the "Add relationship" tap nobody followed through on;
    // a half-filled one the Save gate already refused, so `rel` is what the core
    // calls below accept and nothing else reaches them.
    if (relationshipRowPending(row)) continue;
    const rel = relationshipDraftToValue(row.draft);
    if (rel === null) continue;
    const otherLabel = otherLabelOf(row.draft);
    const { savedId, derived, edited } = row;
    if (savedId !== undefined) {
      if (edited === true) {
        await attempt(otherLabel, () =>
          core.relationships.editFromSubject({
            ...subject,
            relId: savedId,
            otherRole: rel.otherRole,
            otherRoleNote: rel.otherRoleNote,
          }),
        );
      }
      continue;
    }
    if (derived !== undefined) {
      // An inferred neighbour is already true; only a change to it needs
      // writing, and writing it is what turns it into a stored edge.
      if (edited === true && rel.other === "existing") {
        await attempt(otherLabel, () =>
          core.relationships.createFromSubject({ ...subject, ...rel }),
        );
      }
      continue;
    }
    await attempt(otherLabel, () =>
      rel.other === "existing"
        ? core.relationships.createFromSubject({ ...subject, ...rel })
        : core.relationships.createWithNewOther({ ...subject, ...rel }),
    );
  }
  for (const gone of removedRows(initial.relationships, value.relationships)) {
    // A stored edge is deleted; an inferred one has nothing to delete, so it is
    // *dismissed* — a remembered "no, they aren't", which is what stops the
    // engine proposing it again.
    const label = otherLabelOf(gone.draft);
    const other = gone.draft.other;
    if (gone.savedId !== undefined) {
      const id = gone.savedId;
      await attempt(label, () => core.relationships.softDelete(id));
    } else if (gone.derived !== undefined && other?.kind === "existing") {
      const role = gone.derived.baseRole;
      await attempt(label, () =>
        core.kinship.dismiss(bearerType, bearerId, other.type, other.id, role),
      );
    }
  }

  // ---- Gifts --------------------------------------------------------------
  const dropped = new Set(value.gifts.removed);
  for (const [id, given] of Object.entries(value.gifts.given)) {
    if (dropped.has(id)) continue;
    await attempt("a gift", () => core.gifts.recipients.update(id, { given }));
  }
  for (const id of value.gifts.removed) {
    await attempt("a gift", () => core.gifts.recipients.softDelete(id));
  }
  // One `capture` per added gift: the payload carries one idea and N recipients,
  // and each staged gift is its own idea. The entity is the sole recipient.
  //
  // A row nobody filled in is skipped rather than written — the "Add gift" tap
  // that went nowhere, exactly as an empty contact row is skipped. The pool is
  // listed once, and only if there is anything to write: `giftIdeaOf` needs it to
  // reuse an existing idea rather than mint a second one under the same title,
  // and unlike the capture screen this write has no pool of its own to hand.
  const addedGifts = value.gifts.added.filter(
    (gift) => !giftDraftEmpty(gift.draft),
  );
  const ideaPool = addedGifts.length === 0 ? [] : await core.gifts.ideas.list();
  for (const { draft } of addedGifts) {
    await attempt(draft.title, () =>
      core.gifts.capture({
        giftIdea: giftIdeaOf(draft, ideaPool),
        recipients: [
          captureRecipientOf({ type: bearerType, id: bearerId }, draft.given),
        ],
      }),
    );
  }

  return failed;
}

/** What to call a staged milestone — its kind, or the note an `other` carries. */
function stagedMilestoneLabel(row: StagedMilestone): string {
  return milestoneLabel(milestoneDraftToValue(row.draft));
}

/** The rows that were there when the form opened and aren't there now. */
function removedRows<T extends { key: string }>(
  initial: readonly T[],
  current: readonly T[],
): T[] {
  const kept = new Set(current.map((row) => row.key));
  return initial.filter((row) => !kept.has(row.key));
}

/** A staged contact method as its kind's `create` call. */
function createContact(
  core: CoreApi,
  owner: { ownerType: "person"; ownerId: string },
  value: ContactFormValue,
): Promise<unknown> {
  if (value.kind === "email") {
    return core.contactMethods.emails.create({
      ...owner,
      label: value.label,
      address: value.address,
    });
  }
  if (value.kind === "phone") {
    return core.contactMethods.phones.create({
      ...owner,
      label: value.label,
      number: value.number,
      extension: value.extension,
      country: value.country,
      smsCapable: value.smsCapable,
      reachableOn: value.reachableOn,
    });
  }
  if (value.kind === "postal") {
    return core.contactMethods.postals.create({
      ...owner,
      label: value.label,
      line1: value.line1,
      line2: value.line2,
      locality: value.locality,
      region: value.region,
      postalCode: value.postalCode,
      country: value.country,
    });
  }
  return core.contactMethods.socials.create({
    ...owner,
    label: value.label,
    platform: value.platform,
    handle: value.handle,
    platformUserId: value.platformUserId,
    url: value.url,
  });
}

/** The same value as its kind's `update` call — the owner never moves. */
function updateContact(
  core: CoreApi,
  id: string,
  value: ContactFormValue,
): Promise<unknown> {
  if (value.kind === "email") {
    return core.contactMethods.emails.update(id, {
      label: value.label,
      address: value.address,
    });
  }
  if (value.kind === "phone") {
    return core.contactMethods.phones.update(id, {
      label: value.label,
      number: value.number,
      extension: value.extension,
      country: value.country,
      smsCapable: value.smsCapable,
      reachableOn: value.reachableOn,
    });
  }
  if (value.kind === "postal") {
    return core.contactMethods.postals.update(id, {
      label: value.label,
      line1: value.line1,
      line2: value.line2,
      locality: value.locality,
      region: value.region,
      postalCode: value.postalCode,
      country: value.country,
    });
  }
  return core.contactMethods.socials.update(id, {
    label: value.label,
    platform: value.platform,
    handle: value.handle,
    platformUserId: value.platformUserId,
    url: value.url,
  });
}

/** Which table a removed row belongs to is the only thing its kind decides. */
function deleteContact(
  core: CoreApi,
  id: string,
  kind: StagedContact["draft"]["kind"],
): Promise<void> {
  if (kind === "email") return core.contactMethods.emails.softDelete(id);
  if (kind === "phone") return core.contactMethods.phones.softDelete(id);
  if (kind === "postal") return core.contactMethods.postals.softDelete(id);
  return core.contactMethods.socials.softDelete(id);
}
