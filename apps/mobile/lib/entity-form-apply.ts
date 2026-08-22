import type { CoreApi } from "@leapsake/core";
import { type EntityType, milestoneLabel } from "@leapsake/schema";
import { captureRecipientOf, giftIdeaOf } from "@leapsake/ui/headless";
import { contactDraftToValue } from "../components/ContactMethodFields";
import { giftDraftEmpty } from "../components/GiftFields";
import { milestoneDraftToValue } from "../components/MilestoneFields";
import {
  otherLabelOf,
  relationshipDraftToValue,
} from "../components/RelationshipFields";
import { contactRowPending } from "../components/StagedContactsSection";
import { milestoneRowPending } from "../components/StagedMilestonesSection";
import { relationshipRowPending } from "../components/StagedRelationshipsSection";
import { createContact } from "./contact-writes";
import type { EntityFormValue } from "./entity-form";

/**
 * Write everything staged on the create form against the person or pet that has
 * just been created — the one pass that turns {@link EntityFormSections} into
 * database calls.
 *
 * **It writes all of it.** There was a second caller once — a form over a saved
 * record — and this compared the two and wrote the difference: a row with no
 * saved id created, a row whose editor had been touched updated, a row that had
 * gone deleted. Every part of a saved record is edited on a small screen of its
 * own now, each with a Save that writes one thing, so nothing arrives here but
 * rows that never existed. What is left is the plain reading: create each row,
 * skip the ones nobody filled in.
 *
 * **There is no rollback.** By the time this runs the entity exists, and
 * abandoning the rest because a phone number failed to write would throw away
 * more than it rescued. Failures are collected by name and returned; the caller
 * names them and carries on to the detail page, where whatever didn't take is
 * one tap from being redone — and now that every section on that page can be
 * written from the row it sits on, that is a real offer rather than a second
 * trip through this form.
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
    const fields = milestoneDraftToValue(row.draft);
    await attempt(milestoneLabel(fields), () =>
      core.milestones.create({ ...fields, bearerType, bearerId }),
    );
  }

  // ---- Contact methods ----------------------------------------------------
  // Person-owned only; the form stages none for a pet.
  for (const row of value.contacts) {
    // A row every one of whose editors is open has to be allowed to be empty;
    // an empty one is nothing to write.
    if (contactRowPending(row)) continue;
    const method = contactDraftToValue(row.draft);
    await attempt(method.label, () => createContact(core, owner, method));
  }

  // ---- Holidays -----------------------------------------------------------
  // An observance is a fact about a pair; the form only ever adds one.
  for (const holiday of value.holidays) {
    await attempt(holiday.name, () =>
      core.holidays.setObservers(holiday.id, [
        { bearerType, bearerId, observes: true },
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
    await attempt(otherLabelOf(row.draft), () =>
      rel.other === "existing"
        ? core.relationships.createFromSubject({ ...subject, ...rel })
        : core.relationships.createWithNewOther({ ...subject, ...rel }),
    );
  }

  // ---- Gifts --------------------------------------------------------------
  // One `capture` per gift: the payload carries one idea and N recipients, and
  // each staged gift is its own idea. The entity is the sole recipient.
  //
  // A row nobody filled in is skipped rather than written — the "Add gift" tap
  // that went nowhere, exactly as an empty contact row is skipped. The pool is
  // listed once, and only if there is anything to write: `giftIdeaOf` needs it to
  // reuse an existing idea rather than mint a second one under the same title,
  // and unlike the capture screen this write has no pool of its own to hand.
  const gifts = value.gifts.filter((gift) => !giftDraftEmpty(gift.draft));
  const ideaPool = gifts.length === 0 ? [] : await core.gifts.ideas.list();
  for (const { draft } of gifts) {
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
