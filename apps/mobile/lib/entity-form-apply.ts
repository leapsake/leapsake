import { contactMethodInputOf } from "@leapsake/contact-links";
import type { CoreApi } from "@leapsake/core";
import {
  type EntityType,
  milestoneInputOf,
  milestoneLabel,
  relationshipInputOf,
} from "@leapsake/schema";
import { captureRecipientOf, giftIdeaOf } from "@leapsake/ui/headless";
import { giftDraftEmpty } from "../components/GiftFields";
import { otherLabelOf } from "../components/RelationshipFields";
import { contactRowPending } from "../components/StagedContactsSection";
import { milestoneRowPending } from "../components/StagedMilestonesSection";
import { relationshipRowPending } from "../components/StagedRelationshipsSection";
import { createContact } from "./contact-writes";
import type { EntityFormValue } from "./entity-form";

/**
 * Create every row staged on the create form, skipping empty ones. No
 * rollback: failures are returned by name, and the rest still lands.
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

  // Milestones
  for (const row of value.milestones) {
    // An empty row is the "Add milestone" tap nobody followed through on.
    if (milestoneRowPending(row)) continue;
    const shaped = milestoneInputOf(row.draft);
    if (!shaped.ok) continue;
    const fields = shaped.input;
    await attempt(milestoneLabel(fields), () =>
      core.milestones.create({ ...fields, bearerType, bearerId }),
    );
  }

  // Contact methods: person-owned only; the form stages none for a pet.
  for (const row of value.contacts) {
    if (contactRowPending(row)) continue;
    const shaped = contactMethodInputOf(row.draft);
    if (!shaped.ok) continue;
    const method = shaped.input;
    await attempt(method.label, () => createContact(core, owner, method));
  }

  // Holidays: the form only ever adds an observance.
  for (const holiday of value.holidays) {
    await attempt(holiday.name, () =>
      core.holidays.setObservers(holiday.id, [
        { bearerType, bearerId, observes: true },
      ]),
    );
  }

  // Relationships: the entity is the subject, and core implies its role from
  // the other's, creating an other end that does not exist yet.
  const subject = { subjectType: bearerType, subjectId: bearerId };
  for (const row of value.relationships) {
    // The Save gate already refused a half-filled row.
    if (relationshipRowPending(row)) continue;
    const shaped = relationshipInputOf(row.draft);
    if (!shaped.ok) continue;
    const rel = shaped.input;
    await attempt(otherLabelOf(row.draft), () =>
      rel.other === "existing"
        ? core.relationships.createFromSubject({ ...subject, ...rel })
        : core.relationships.createWithNewOther({ ...subject, ...rel }),
    );
  }

  // Gifts: one `capture` each. The pool lets `giftIdeaOf` reuse an idea of
  // the same title, and is listed only when there is something to write.
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
