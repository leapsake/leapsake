import {
  type ContactMethodKind,
  type CreateMilestoneInput,
  type CreatePersonInput,
  type CreatePetInput,
  type EntityType,
  type Gender,
  type MilestoneKind,
  type MilestoneBearerType,
  type RelationshipRole,
  type ReminderRuleInput,
  type UpdateMilestoneInput,
  createMilestoneInputSchema,
  createRelationshipInputSchema,
  dueMsFromIso,
  fullName,
  isReminderEditable,
  parseTagNames,
  preferredBearerType,
  updateMilestoneInputSchema,
  updateRelationshipInputSchema,
} from "@leapsake/schema";
import { findPlatform, normalizeFor } from "@leapsake/contact-links";
import { entityBasePath } from "@leapsake/ui/headless";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type RouteObject,
  createHashRouter,
  redirect,
} from "react-router-dom";
import { App } from "./App";
import { Acknowledgements } from "./screens/Acknowledgements";
import { ContactMethodCreate } from "./screens/ContactMethodCreate";
import { ContactMethodDelete } from "./screens/ContactMethodDelete";
import { ContactMethodEdit } from "./screens/ContactMethodEdit";
import { EntityList } from "./screens/EntityList";
import { ErrorPage } from "./screens/ErrorPage";
import { PersonCreate } from "./screens/PersonCreate";
import { PersonDelete } from "./screens/PersonDelete";
import { PersonEdit } from "./screens/PersonEdit";
import { PersonMerge } from "./screens/PersonMerge";
import { Duplicates } from "./screens/Duplicates";
import { GiftIdeaDelete } from "./screens/GiftIdeaDelete";
import { GiftIdeaEdit } from "./screens/GiftIdeaEdit";
import { GiftCreate } from "./screens/GiftCreate";
import { GiftList } from "./screens/GiftList";
import { MilestoneCreate } from "./screens/MilestoneCreate";
import { MilestoneDelete } from "./screens/MilestoneDelete";
import { MilestoneEdit } from "./screens/MilestoneEdit";
import { MilestoneRebind } from "./screens/MilestoneRebind";
import { PersonView } from "./screens/PersonView";
import { PetCreate } from "./screens/PetCreate";
import { PetDelete } from "./screens/PetDelete";
import { PetEdit } from "./screens/PetEdit";
import { PetView } from "./screens/PetView";
import { RelationshipCreate } from "./screens/RelationshipCreate";
import { RelationshipDelete } from "./screens/RelationshipDelete";
import { RelationshipDismiss } from "./screens/RelationshipDismiss";
import { RelationshipEdit } from "./screens/RelationshipEdit";
import { RelationshipRolesEdit } from "./screens/RelationshipRolesEdit";
import { RelationshipRowDelete } from "./screens/RelationshipRowDelete";
import { RelationshipView } from "./screens/RelationshipView";
import { ReminderCreate } from "./screens/ReminderCreate";
import { ReminderDelete } from "./screens/ReminderDelete";
import { ReminderEdit } from "./screens/ReminderEdit";
import { MilestonePlanPrompt } from "./screens/MilestonePlanPrompt";
import { ReminderList } from "./screens/ReminderList";
import { Settings } from "./screens/Settings";
import { TagDelete } from "./screens/TagDelete";
import { HolidayList } from "./screens/HolidayList";
import { HolidayObservanceSchedule } from "./screens/HolidayObservanceSchedule";
import { HolidayView } from "./screens/HolidayView";
import { TagView } from "./screens/TagView";

/** Parse the Gender select: the empty option means "unset" (null). */
function readGender(formData: FormData): Gender | null {
  const value = String(formData.get("gender") ?? "");
  return value === "" ? null : (value as Gender);
}

/** A name part the form left blank is absent, not an empty string. */
function readNamePart(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

/** A blank name part is null: `personSchema` rejects `""`. */
function readPersonInput(formData: FormData): CreatePersonInput {
  return {
    firstName: readNamePart(formData, "firstName"),
    middleName: readNamePart(formData, "middleName"),
    lastName: readNamePart(formData, "lastName"),
    gender: readGender(formData),
  };
}

/** Pull the editable Pet fields out of a submitted form. */
function readPetInput(formData: FormData): CreatePetInput {
  return { name: String(formData.get("name")), gender: readGender(formData) };
}

/** Pull the desired tag names out of the comma-separated form field. */
function readTags(formData: FormData): string[] {
  return parseTagNames(String(formData.get("tags") ?? ""));
}

/** A role note is meaningful only when non-empty; blank fields become null. */
function readNote(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Parse one milestone date part from the form: blank means absent (null). */
function readDatePart(formData: FormData, key: string): number | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : Number(value);
}

/**
 * The hidden JSON reminder-schedule field: absent leaves the stored rules
 * alone, and an array (even empty) replaces them.
 */
function readReminderSchedule(
  formData: FormData,
): ReminderRuleInput[] | undefined {
  const raw = formData.get("reminderSchedule");
  if (raw === null) return undefined;
  const parsed = JSON.parse(String(raw)) as unknown;
  return Array.isArray(parsed) ? (parsed as ReminderRuleInput[]) : undefined;
}

/** The editable milestone fields: kind, partial date, note and reminders. */
function readMilestoneFields(formData: FormData) {
  return {
    kind: String(formData.get("kind")) as MilestoneKind,
    year: readDatePart(formData, "year"),
    month: readDatePart(formData, "month"),
    day: readDatePart(formData, "day"),
    note: readNote(formData, "note"),
    reminderSchedule: readReminderSchedule(formData),
  };
}

/** The resolved b-side of one relationship row submitted by a create form. */
interface RelationshipDraft {
  bType: EntityType;
  bId: string;
  bRole: RelationshipRole;
  bRoleNote: string | null;
}

/** Parse the create form's relationship rows — each row is one JSON blob. */
function readRelationships(formData: FormData): RelationshipDraft[] {
  return formData
    .getAll("relationships")
    .map((value) => JSON.parse(String(value)) as RelationshipDraft);
}

/** Core implies the subject's own role from each picked b-side role. */
async function createRelationships(
  subjectType: EntityType,
  subjectId: string,
  drafts: RelationshipDraft[],
) {
  for (const draft of drafts) {
    await window.api.relationships.createFromSubject({
      subjectType,
      subjectId,
      otherType: draft.bType,
      otherId: draft.bId,
      otherRole: draft.bRole,
      otherRoleNote: draft.bRoleNote,
    });
  }
}

/** The People & Pets list, plus the self-person's id for the "You" badge. */
async function entityListLoader() {
  const [entities, self, duplicateCount] = await Promise.all([
    window.api.views.entityList(),
    window.api.self.get(),
    window.api.duplicates.count(), // the review link shows only when nonzero
  ]);
  return { entities, selfPersonId: self?.personId ?? null, duplicateCount };
}

/**
 * All duplicate candidates, or with `?for=<personId>` only that person's. An
 * unknown `for` falls back to all: the person may have just been merged away.
 */
async function duplicatesLoader({ request }: LoaderFunctionArgs) {
  const wanted = new URL(request.url).searchParams.get("for");
  if (wanted === null) {
    return {
      candidates: await window.api.duplicates.findCandidates(),
      focus: null,
    };
  }
  const [candidates, person] = await Promise.all([
    window.api.duplicates.findFor(wanted),
    window.api.people.get(wanted),
  ]);
  if (!person) {
    return {
      candidates: await window.api.duplicates.findCandidates(),
      focus: null,
    };
  }
  return {
    candidates,
    focus: { id: person.id, name: fullName(person) },
  };
}

/** Set the self-person from the pick-self flow. */
async function entityListAction({ request }: { request: Request }) {
  const form = await request.formData();
  const personId = String(form.get("personId"));
  await window.api.self.set(personId);
  return redirect("/people");
}

async function personLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const [
    view,
    mentionedIn,
    holidays,
    giftsGiven,
    giftIdeaPool,
    duplicateCandidates,
  ] = await Promise.all([
    window.api.views.person(id),
    window.api.reminders.mentioning("person", id),
    // The whole catalog with this person's answers: the list and the add pool.
    window.api.holidays.listForBearer("person", id),
    window.api.gifts.recipients.listForRecipient("person", id),
    window.api.gifts.ideas.list(),
    // Both people in a pair carry the banner that leads back to the review.
    window.api.duplicates.findFor(id),
  ]);
  if (!view) throw new Response("Person not found", { status: 404 });
  return {
    ...view,
    mentionedIn,
    holidays,
    giftIdeaPool,
    giftsGiven,
    duplicateCandidates,
  };
}

async function petLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const [view, mentionedIn, holidays, giftsGiven, giftIdeaPool] =
    await Promise.all([
      window.api.views.pet(id),
      window.api.reminders.mentioning("pet", id),
      window.api.holidays.listForBearer("pet", id),
      window.api.gifts.recipients.listForRecipient("pet", id),
      window.api.gifts.ideas.list(),
    ]);
  if (!view) throw new Response("Pet not found", { status: 404 });
  return {
    ...view,
    mentionedIn,
    holidays,
    giftIdeaPool,
    giftsGiven,
  };
}

function relationshipNewLoader(subjectType: EntityType) {
  return async ({ params }: LoaderFunctionArgs) => {
    const view = await window.api.views.relationshipNew(
      subjectType,
      params.id as string,
    );
    if (!view) throw new Response("Not found", { status: 404 });
    return view;
  };
}

function relationshipCreateAction(subjectType: EntityType) {
  return async ({ request, params }: ActionFunctionArgs) => {
    const id = params.id as string;
    const formData = await request.formData();
    const input = createRelationshipInputSchema.parse({
      aType: subjectType,
      aId: id,
      aRole: String(formData.get("aRole")),
      aRoleNote: readNote(formData, "aRoleNote"),
      bType: String(formData.get("bType")),
      bId: String(formData.get("bId")),
      bRole: String(formData.get("bRole")),
      bRoleNote: readNote(formData, "bRoleNote"),
    });
    await window.api.relationships.create(input);
    return redirect(`${entityBasePath(subjectType)}/${id}`);
  };
}

/** A stored relationship, oriented to the subject, for its edit and remove. */
function relationshipForSubjectLoader(subjectType: EntityType) {
  return async ({ params }: LoaderFunctionArgs) => {
    const view = await window.api.views.relationshipForSubject(
      subjectType,
      params.id as string,
      params.relId as string,
    );
    if (!view) throw new Response("Relationship not found", { status: 404 });
    return view;
  };
}

function relationshipEditAction(subjectType: EntityType) {
  return async ({ request, params }: ActionFunctionArgs) => {
    const id = params.id as string;
    const formData = await request.formData();
    // Only the other end's role is edited; core re-derives the subject's own.
    await window.api.relationships.editFromSubject({
      subjectType,
      subjectId: id,
      relId: params.relId as string,
      otherRole: String(formData.get("otherRole")) as RelationshipRole,
      otherRoleNote: readNote(formData, "otherRoleNote"),
    });
    return redirect(`${entityBasePath(subjectType)}/${id}`);
  };
}

function relationshipDeleteAction(subjectType: EntityType) {
  return async ({ params }: ActionFunctionArgs) => {
    await window.api.relationships.softDelete(params.relId as string);
    return redirect(`${entityBasePath(subjectType)}/${params.id}`);
  };
}

/**
 * A derived relationship for its edit and dismiss screens. It has no stored
 * row, so its identity (other endpoint and role) travels in the query string.
 */
function relationshipDerivedLoader(subjectType: EntityType) {
  return async ({ params, request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const otherType = url.searchParams.get("otherType") as EntityType | null;
    const otherId = url.searchParams.get("otherId");
    const role = url.searchParams.get("role") as RelationshipRole | null;
    if (!otherType || !otherId || !role)
      throw new Response("Bad derived-relationship request", { status: 400 });

    const view = await window.api.views.derivedRelationship(
      subjectType,
      params.id as string,
      otherType,
      otherId,
      role,
    );
    if (!view)
      throw new Response("Derived relationship not found", { status: 404 });
    return view;
  };
}

/**
 * Editing a derived relationship materialises it as an explicit one with the
 * chosen role, which then suppresses the derived edge.
 */
function relationshipDerivedEditAction(subjectType: EntityType) {
  return async ({ request, params }: ActionFunctionArgs) => {
    const id = params.id as string;
    const url = new URL(request.url);
    const otherType = url.searchParams.get("otherType") as EntityType | null;
    const otherId = url.searchParams.get("otherId");
    if (!otherType || !otherId)
      throw new Response("Bad derived-relationship request", { status: 400 });

    const formData = await request.formData();
    await window.api.relationships.createFromSubject({
      subjectType,
      subjectId: id,
      otherType,
      otherId,
      otherRole: String(formData.get("otherRole")) as RelationshipRole,
      otherRoleNote: readNote(formData, "otherRoleNote"),
    });
    return redirect(`${entityBasePath(subjectType)}/${id}`);
  };
}

function relationshipDismissAction(subjectType: EntityType) {
  return async ({ request, params }: ActionFunctionArgs) => {
    const id = params.id as string;
    const formData = await request.formData();
    await window.api.kinship.dismiss(
      subjectType,
      id,
      String(formData.get("otherType")) as EntityType,
      String(formData.get("otherId")),
      String(formData.get("role")) as RelationshipRole,
    );
    return redirect(`${entityBasePath(subjectType)}/${id}`);
  };
}

/**
 * From a Person, the view also carries the candidates and existing edges the
 * relationship kinds' "with whom?" step needs.
 */
function milestoneNewLoader(bearerType: MilestoneBearerType) {
  return async ({ params }: LoaderFunctionArgs) => {
    const view = await window.api.views.milestoneNew(
      bearerType,
      params.id as string,
    );
    if (!view) throw new Response("Not found", { status: 404 });
    return view;
  };
}

/**
 * Resolve a "with whom?" answer to the milestone's bearer: an existing
 * relationship, a new one, or the person. Null means nothing was chosen.
 */
async function resolveWithWhom(
  personId: string,
  formData: FormData,
): Promise<{ bearerType: MilestoneBearerType; bearerId: string } | null> {
  const mode = String(formData.get("relMode") ?? "");
  if (mode === "bind") {
    return {
      bearerType: "relationship",
      bearerId: String(formData.get("relId")),
    };
  }
  if (mode === "create") {
    const rel = await window.api.relationships.createFromSubject({
      subjectType: "person",
      subjectId: personId,
      otherType: String(formData.get("withType")) as EntityType,
      otherId: String(formData.get("withId")),
      otherRole: String(formData.get("relRole")) as RelationshipRole,
    });
    return { bearerType: "relationship", bearerId: rel.id };
  }
  if (mode === "unbound") {
    return { bearerType: "person", bearerId: personId };
  }
  return null;
}

/**
 * The bearer comes from the route, except for a relationship kind added from a
 * Person; there, no "with whom?" answer cancels the add.
 */

function milestoneCreateAction(bearerType: MilestoneBearerType) {
  return async ({ request, params }: ActionFunctionArgs) => {
    const id = params.id as string;
    const formData = await request.formData();
    const fields = readMilestoneFields(formData);

    let bearer: { bearerType: MilestoneBearerType; bearerId: string } = {
      bearerType,
      bearerId: id,
    };
    if (
      bearerType === "person" &&
      preferredBearerType(fields.kind) === "relationship"
    ) {
      const resolved = await resolveWithWhom(id, formData);
      if (!resolved) return redirect(`${entityBasePath(bearerType)}/${id}`);
      bearer = resolved;
    }

    const input: CreateMilestoneInput = createMilestoneInputSchema.parse({
      ...bearer,
      ...fields,
    });
    await window.api.milestones.create(input);
    return redirect(`${entityBasePath(bearerType)}/${id}`);
  };
}

/** A milestone, found in its bearer's list, for its edit and delete. */
function milestoneForBearerLoader(bearerType: MilestoneBearerType) {
  return async ({ params }: LoaderFunctionArgs) => {
    const id = params.id as string;
    const milestoneId = params.milestoneId as string;
    const bearer = await window.api.views.milestoneBearer(bearerType, id);
    if (!bearer) throw new Response("Not found", { status: 404 });
    const milestones = await window.api.milestones.listForBearer(
      bearerType,
      id,
    );
    const milestone = milestones.find((m) => m.id === milestoneId);
    if (!milestone) throw new Response("Milestone not found", { status: 404 });
    // Its stored rules, else its kind's defaults.
    const reminderSchedule = await window.api.milestones.reminderSchedule(
      milestoneId,
      milestone.kind,
    );
    return { bearer, milestone, reminderSchedule };
  };
}

function milestoneEditAction(bearerType: MilestoneBearerType) {
  return async ({ request, params }: ActionFunctionArgs) => {
    const id = params.id as string;
    const formData = await request.formData();
    const input: UpdateMilestoneInput = updateMilestoneInputSchema.parse(
      readMilestoneFields(formData),
    );
    await window.api.milestones.update(params.milestoneId as string, input);
    return redirect(`${entityBasePath(bearerType)}/${id}`);
  };
}

function milestoneDeleteAction(bearerType: MilestoneBearerType) {
  return async ({ params }: ActionFunctionArgs) => {
    await window.api.milestones.softDelete(params.milestoneId as string);
    return redirect(`${entityBasePath(bearerType)}/${params.id}`);
  };
}

/**
 * Rebinding a relationship-kind milestone stored on a Person (a Wedding whose
 * spouse was unknown) to a relationship.
 */
async function milestoneRebindLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const milestoneId = params.milestoneId as string;
  const bearer = await window.api.views.milestoneBearer("person", id);
  if (!bearer) throw new Response("Not found", { status: 404 });
  const milestones = await window.api.milestones.listForBearer("person", id);
  const milestone = milestones.find((m) => m.id === milestoneId);
  if (!milestone) throw new Response("Milestone not found", { status: 404 });
  const [candidates, neighbors] = await Promise.all([
    window.api.views.candidates({ type: "person", id }),
    window.api.relationships.listForEntity("person", id),
  ]);
  return { bearer, milestone, candidates, neighbors };
}

/** Only a relationship is a rebind target; any other answer is a no-op. */
async function milestoneRebindAction({ request, params }: ActionFunctionArgs) {
  const id = params.id as string;
  const milestoneId = params.milestoneId as string;
  const formData = await request.formData();
  const resolved = await resolveWithWhom(id, formData);
  if (resolved && resolved.bearerType === "relationship") {
    await window.api.milestones.update(milestoneId, {
      bearerType: resolved.bearerType,
      bearerId: resolved.bearerId,
    });
  }
  return redirect(`/people/${id}`);
}

function readContactLabel(formData: FormData): string {
  return String(formData.get("label") ?? "").trim();
}

/** An ISO alpha-2 country: uppercased, blank → null. */
function readContactCountry(formData: FormData): string | null {
  const value = String(formData.get("country") ?? "")
    .trim()
    .toUpperCase();
  return value === "" ? null : value;
}

/**
 * Reduces the handle to its bare form (`@george`, `instagram.com/george` →
 * `george`), which depends on the platform the form was showing.
 */
function readSocialFields(formData: FormData) {
  const platform = String(formData.get("platform") ?? "");
  return {
    platform,
    handle: normalizeFor(
      findPlatform(platform),
      String(formData.get("handle") ?? ""),
    ),
    platformUserId: readNote(formData, "platformUserId"),
    url: readNote(formData, "url"),
  };
}

async function contactPersonSubject(id: string) {
  const person = await window.api.people.get(id);
  if (!person) throw new Response("Person not found", { status: 404 });
  return { id, label: fullName(person) };
}

async function contactNewLoader({ params }: LoaderFunctionArgs) {
  const subject = await contactPersonSubject(params.id as string);
  return { subject, kind: params.kind as ContactMethodKind };
}

/** A contact method, found in its owner's list, for its edit and delete. */
async function contactMethodLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const kind = params.kind as ContactMethodKind;
  const methodId = params.methodId as string;
  const subject = await contactPersonSubject(id);
  const methods = await window.api.contactMethods.listForOwner("person", id);
  const entry = methods.find(
    (m) => m.kind === kind && m.method.id === methodId,
  );
  if (!entry) throw new Response("Contact method not found", { status: 404 });
  return { subject, kind, method: entry.method, entry };
}

async function contactCreateAction({ request, params }: ActionFunctionArgs) {
  const id = params.id as string;
  const kind = params.kind as ContactMethodKind;
  const formData = await request.formData();
  const owner = { ownerType: "person" as const, ownerId: id };
  const label = readContactLabel(formData);

  if (kind === "email") {
    await window.api.contactMethods.emails.create({
      ...owner,
      label,
      address: String(formData.get("address")),
    });
  } else if (kind === "phone") {
    await window.api.contactMethods.phones.create({
      ...owner,
      label,
      number: String(formData.get("number")),
      extension: readNote(formData, "extension"),
      country: readContactCountry(formData),
      smsCapable: formData.has("smsCapable"),
      reachableOn: formData.getAll("reachableOn").map(String),
    });
  } else if (kind === "social") {
    await window.api.contactMethods.socials.create({
      ...owner,
      label,
      ...readSocialFields(formData),
    });
  } else {
    await window.api.contactMethods.postals.create({
      ...owner,
      label,
      line1: String(formData.get("line1")),
      line2: readNote(formData, "line2"),
      locality: readNote(formData, "locality"),
      region: readNote(formData, "region"),
      postalCode: readNote(formData, "postalCode"),
      country: readContactCountry(formData),
    });
  }
  return redirect(`/people/${id}`);
}

async function contactEditAction({ request, params }: ActionFunctionArgs) {
  const id = params.id as string;
  const kind = params.kind as ContactMethodKind;
  const methodId = params.methodId as string;
  const formData = await request.formData();
  const label = readContactLabel(formData);

  if (kind === "email") {
    await window.api.contactMethods.emails.update(methodId, {
      label,
      address: String(formData.get("address")),
    });
  } else if (kind === "phone") {
    await window.api.contactMethods.phones.update(methodId, {
      label,
      number: String(formData.get("number")),
      extension: readNote(formData, "extension"),
      country: readContactCountry(formData),
      smsCapable: formData.has("smsCapable"),
      reachableOn: formData.getAll("reachableOn").map(String),
    });
  } else if (kind === "social") {
    await window.api.contactMethods.socials.update(methodId, {
      label,
      ...readSocialFields(formData),
    });
  } else {
    await window.api.contactMethods.postals.update(methodId, {
      label,
      line1: String(formData.get("line1")),
      line2: readNote(formData, "line2"),
      locality: readNote(formData, "locality"),
      region: readNote(formData, "region"),
      postalCode: readNote(formData, "postalCode"),
      country: readContactCountry(formData),
    });
  }
  return redirect(`/people/${id}`);
}

async function contactDeleteAction({ params }: ActionFunctionArgs) {
  const kind = params.kind as ContactMethodKind;
  const methodId = params.methodId as string;
  if (kind === "email") {
    await window.api.contactMethods.emails.softDelete(methodId);
  } else if (kind === "phone") {
    await window.api.contactMethods.phones.softDelete(methodId);
  } else if (kind === "social") {
    await window.api.contactMethods.socials.softDelete(methodId);
  } else {
    await window.api.contactMethods.postals.softDelete(methodId);
  }
  return redirect(`/people/${params.id}`);
}

/** The relationship page, canonical home of its milestones. */
async function relationshipViewLoader({ params }: LoaderFunctionArgs) {
  const view = await window.api.views.relationship(params.id as string);
  if (!view) throw new Response("Relationship not found", { status: 404 });
  return view;
}

/**
 * Both endpoints with their roles, for editing the relationship as a whole,
 * unlike the subject-scoped screens that edit only the other end.
 */
async function relationshipPartnersLoader({ params }: LoaderFunctionArgs) {
  const view = await window.api.views.relationshipPartners(params.id as string);
  if (!view) throw new Response("Relationship not found", { status: 404 });
  return view;
}

/** Writes both roles exactly as picked; neither is derived from the other. */
async function relationshipRolesEditAction({
  request,
  params,
}: ActionFunctionArgs) {
  const id = params.id as string;
  const formData = await request.formData();
  const input = updateRelationshipInputSchema.parse({
    aRole: String(formData.get("aRole")) as RelationshipRole,
    aRoleNote: readNote(formData, "aRoleNote"),
    bRole: String(formData.get("bRole")) as RelationshipRole,
    bRoleNote: readNote(formData, "bRoleNote"),
  });
  await window.api.relationships.update(id, input);
  return redirect(`/relationships/${id}`);
}

/** Removes the relationship for both partners, then lands on the first one. */
async function relationshipRowDeleteAction({ params }: ActionFunctionArgs) {
  const id = params.id as string;
  const rel = await window.api.relationships.get(id);
  await window.api.relationships.softDelete(id);
  return redirect(rel ? `${entityBasePath(rel.aType)}/${rel.aId}` : "/people");
}

/** The editable reminder fields; blank fields become null. */
function readReminderInput(formData: FormData): {
  title: string | null;
  body: string | null;
  dueDate: number | null;
} {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  return {
    title: title.length > 0 ? title : null,
    body: body.length > 0 ? body : null,
    // "YYYY-MM-DD", or "" when cleared.
    dueDate: dueMsFromIso(String(formData.get("dueDate") ?? "")),
  };
}

async function reminderLoader({ params }: LoaderFunctionArgs) {
  const reminder = await window.api.reminders.get(params.id as string);
  if (!reminder) throw new Response("Reminder not found", { status: 404 });
  return reminder;
}

/** An automatic reminder's text is the engine's, so editing one bounces. */
async function reminderEditLoader(args: LoaderFunctionArgs) {
  const reminder = await reminderLoader(args);
  if (!isReminderEditable(reminder)) return redirect("/reminders");
  return reminder;
}

/** Create a reminder; both fields blank is a no-op back to the list. */
async function reminderCreateAction({ request }: ActionFunctionArgs) {
  const input = readReminderInput(await request.formData());
  if (input.title === null && input.body === null)
    return redirect("/reminders");
  await window.api.reminders.create(input);
  return redirect("/reminders");
}

/** Save edits to a reminder — core re-derives its #tags from the new text. */
async function reminderEditAction({ request, params }: ActionFunctionArgs) {
  const input = readReminderInput(await request.formData());
  if (input.title === null && input.body === null)
    return redirect("/reminders");
  await window.api.reminders.update(params.id as string, input);
  return redirect("/reminders");
}

async function reminderDeleteAction({ params }: ActionFunctionArgs) {
  await window.api.reminders.softDelete(params.id as string);
  return redirect("/reminders");
}

/** The editable gift-idea fields; blank url and notes become null. */
function readGiftIdeaInput(formData: FormData): {
  title: string;
  url: string | null;
  notes: string | null;
} {
  const url = String(formData.get("url") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  return {
    title: String(formData.get("title") ?? "").trim(),
    url: url.length > 0 ? url : null,
    notes: notes.length > 0 ? notes : null,
  };
}

async function giftIdeaLoader({ params }: LoaderFunctionArgs) {
  const idea = await window.api.gifts.ideas.get(params.id as string);
  if (!idea) throw new Response("Gift idea not found", { status: 404 });
  return idea;
}

/** The idea, its "Suggested for" recipients, and the pool to add from. */
async function giftIdeaEditLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const [idea, tags, recipients, entities] = await Promise.all([
    window.api.gifts.ideas.get(id),
    window.api.tags.listForGiftIdea(id),
    window.api.gifts.recipients.listForIdea(id),
    window.api.views.entityList(),
  ]);
  if (!idea) throw new Response("Gift idea not found", { status: 404 });
  const candidates = entities.map((e) => ({
    type: e.type,
    id: e.id,
    label: e.label,
  }));
  return {
    idea,
    tagNames: tags.map((t) => t.name).join(", "),
    recipients,
    candidates,
  };
}

/**
 * `?recipient=<type>:<id>`, from a done gift reminder, fixes the form to that
 * recipient to log a giving; an unknown one falls back to the picker.
 */
async function giftCreateLoader({ request }: LoaderFunctionArgs) {
  const [ideas, entities] = await Promise.all([
    window.api.gifts.ideas.list(),
    window.api.views.entityList(),
  ]);
  const candidates = entities.map((e) => ({
    type: e.type,
    id: e.id,
    label: e.label,
  }));
  const wanted = new URL(request.url).searchParams.get("recipient");
  const fixedRecipient =
    wanted === null
      ? undefined
      : candidates.find((c) => `${c.type}:${c.id}` === wanted);
  return { ideas, candidates, fixedRecipient };
}

/** `listInWindow`, not `list`: the time buckets need more than stored rows. */
async function remindersLoader() {
  const [reminders, targets, duplicatesNudgeId] = await Promise.all([
    window.api.reminders.listInWindow(),
    // What the gift, plan and wish rows each act on, from one engine walk.
    window.api.reminders.targets(),
    // Derived from the outstanding pairs, so it cannot be a static id.
    window.api.duplicates.nudgeId(),
  ]);
  return { reminders, targets, duplicatesNudgeId };
}

/** The prompt's own screen: the offer set for the milestone being asked about. */
async function milestonePlanLoader({ params }: LoaderFunctionArgs) {
  const milestoneId = params.milestoneId as string;
  const target = (await window.api.reminders.targets()).plans.find(
    (t) => t.milestoneId === milestoneId,
  );
  // Already answered, or not in window.
  if (target === undefined)
    throw new Response("No prompt for this milestone", { status: 404 });
  return { target };
}

/**
 * Answer the prompt, from the screen or the list row's *Just the day*. The
 * update replaces the rule set, which retires the prompt in the same call.
 */

async function milestonePlanAction({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  await window.api.milestones.update(params.milestoneId as string, {
    reminderSchedule: readReminderSchedule(formData) ?? [],
  });
  return redirect("/reminders");
}

/** Save edits to a gift idea; a blank title is a no-op back to the list. The
 *  form always carries the tags field, so the whole desired set goes with the
 *  write (a Person saves its tags the same way). */
async function giftIdeaEditAction({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const input = readGiftIdeaInput(formData);
  if (input.title === "") return redirect("/gifts");
  await window.api.gifts.ideas.update(
    params.id as string,
    input,
    readTags(formData),
  );
  return redirect("/gifts");
}

/** Remove a gift idea. */
async function giftIdeaDeleteAction({ params }: ActionFunctionArgs) {
  await window.api.gifts.ideas.softDelete(params.id as string);
  return redirect("/gifts");
}

/** Toggle completion — posted by a list-row fetcher, so it revalidates in place. */
async function reminderToggleAction({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  await window.api.reminders.setCompleted(
    params.id as string,
    String(formData.get("completed")) === "true",
  );
  return null;
}

/**
 * Put a reminder off — posted by one of the list row's "Remind me…" fetchers, so
 * the list revalidates and the row drops out of Today in place.
 *
 * It posts a day count, the one the offered action carried; core turns it into
 * the day the row comes back. The main process re-validates it at the IPC
 * boundary, which is what stops a mangled form value from reaching core.
 */
async function reminderSnoozeAction({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  await window.api.reminders.snooze(
    params.id as string,
    Number(formData.get("days")),
  );
  return null;
}

const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    errorElement: <ErrorPage />,
    children: [
      {
        // The landing screen is Reminders; `/` redirects there. The combined
        // People & Pets list keeps its own path (`/people`), reached from the
        // top nav and the breadcrumb root.
        index: true,
        loader: () => redirect("/reminders"),
      },
      {
        path: "people",
        loader: entityListLoader,
        action: entityListAction,
        element: <EntityList />,
      },
      {
        // Account & sync setup owns its own state (the one-time recovery-key
        // reveal must not survive a loader re-run), so no loader/action here.
        path: "settings",
        element: <Settings />,
      },
      {
        // Static, and deliberately so: no loader, no account, no data. The list it
        // renders is a compile-time constant shared with `apps/mobile`.
        path: "acknowledgements",
        element: <Acknowledgements />,
      },
      {
        // Review duplicates: propose candidate pairs (reconciliation Increment
        // B). The "Not the same" action records the rejection and revalidates
        // this loader in place; "Merge…" routes into the people merge confirm.
        path: "duplicates",
        loader: duplicatesLoader,
        element: <Duplicates />,
        action: async ({ request }) => {
          const formData = await request.formData();
          await window.api.duplicates.reject(
            String(formData.get("idA")),
            String(formData.get("idB")),
          );
          return null;
        },
      },
      {
        // Reminders — a standalone list of user-created reminders (the seed of the
        // future home screen). #tags are parsed inline from the text in core.
        path: "reminders",
        loader: remindersLoader,
        element: <ReminderList />,
      },
      {
        path: "reminders/new",
        element: <ReminderCreate />,
        action: reminderCreateAction,
      },
      {
        path: "reminders/:id/edit",
        loader: reminderEditLoader,
        element: <ReminderEdit />,
        action: reminderEditAction,
      },
      {
        path: "reminders/:id/delete",
        loader: reminderLoader,
        element: <ReminderDelete />,
        action: reminderDeleteAction,
      },
      {
        // Action-only: the list-row "Done/Reopen" fetcher posts here.
        path: "reminders/:id/complete",
        action: reminderToggleAction,
      },
      {
        // Action-only: the list-row "Not now" fetcher posts here.
        path: "reminders/:id/snooze",
        action: reminderSnoozeAction,
      },
      {
        // The prompt's answer — a screen for the full offer set, and the action
        // the row's one-tap "Just the day" fetcher posts to.
        path: "milestones/:milestoneId/plan",
        loader: milestonePlanLoader,
        element: <MilestonePlanPrompt />,
        action: milestonePlanAction,
      },
      {
        // Gifts — the whole graph keyed by idea. Creating is its
        // own screen, so this stays a plain list (the People & Pets pattern).
        path: "gifts",
        loader: () => window.api.gifts.overview(),
        element: <GiftList />,
      },
      {
        path: "gifts/new",
        loader: giftCreateLoader,
        element: <GiftCreate />,
      },
      {
        path: "gifts/:id/edit",
        loader: giftIdeaEditLoader,
        element: <GiftIdeaEdit />,
        action: giftIdeaEditAction,
      },
      {
        path: "gifts/:id/delete",
        loader: giftIdeaLoader,
        element: <GiftIdeaDelete />,
        action: giftIdeaDeleteAction,
      },
      {
        path: "people/new",
        loader: () => window.api.views.candidates(),
        element: <PersonCreate />,
        action: async ({ request }) => {
          const formData = await request.formData();
          const person = await window.api.people.create(
            readPersonInput(formData),
            readTags(formData),
          );
          await createRelationships(
            "person",
            person.id,
            readRelationships(formData),
          );
          // Detection runs at the moment the duplicate is created, which is the
          // moment the user still remembers both entries and can act on them.
          // Only when there is actually something to resolve — otherwise saving
          // lands on the new person as it always has.
          const matches = await window.api.duplicates.findFor(person.id);
          return redirect(
            matches.length > 0
              ? `/duplicates?for=${person.id}`
              : `/people/${person.id}`,
          );
        },
      },
      {
        path: "people/:id",
        loader: personLoader,
        element: <PersonView />,
      },
      {
        path: "people/:id/edit",
        loader: personLoader,
        element: <PersonEdit />,
        action: async ({ request, params }) => {
          const formData = await request.formData();
          await window.api.people.update(
            params.id as string,
            readPersonInput(formData),
            readTags(formData),
          );
          return redirect(`/people/${params.id}`);
        },
      },
      {
        path: "people/:id/delete",
        loader: personLoader,
        element: <PersonDelete />,
        action: async ({ params }) => {
          await window.api.people.softDelete(params.id as string);
          return redirect("/people");
        },
      },
      {
        // Merge a duplicate person into this one: this person survives, the
        // picked duplicate's facts re-point onto it, then it is tombstoned.
        path: "people/:id/merge",
        loader: async ({ params, request }: LoaderFunctionArgs) => {
          const id = params.id as string;
          const person = await window.api.people.get(id);
          if (!person) throw new Response("Person not found", { status: 404 });
          const others = (await window.api.people.list()).filter(
            (p) => p.id !== id,
          );
          // Preselect the duplicate when arriving from "Review duplicates".
          const defaultLoserId =
            new URL(request.url).searchParams.get("loser") ?? "";
          return { person, others, defaultLoserId };
        },
        element: <PersonMerge />,
        action: async ({ request, params }) => {
          const id = params.id as string;
          const formData = await request.formData();
          const loserId = String(formData.get("loserId"));
          await window.api.people.merge(id, loserId);
          return redirect(`/people/${id}`);
        },
      },
      {
        path: "people/:id/relationships/new",
        loader: relationshipNewLoader("person"),
        element: <RelationshipCreate />,
        action: relationshipCreateAction("person"),
      },
      {
        path: "people/:id/relationships/:relId/edit",
        loader: relationshipForSubjectLoader("person"),
        element: <RelationshipEdit />,
        action: relationshipEditAction("person"),
      },
      {
        path: "people/:id/relationships/:relId/delete",
        loader: relationshipForSubjectLoader("person"),
        element: <RelationshipDelete />,
        action: relationshipDeleteAction("person"),
      },
      {
        path: "people/:id/relationships/edit",
        loader: relationshipDerivedLoader("person"),
        element: <RelationshipEdit />,
        action: relationshipDerivedEditAction("person"),
      },
      {
        path: "people/:id/relationships/dismiss",
        loader: relationshipDerivedLoader("person"),
        element: <RelationshipDismiss />,
        action: relationshipDismissAction("person"),
      },
      {
        path: "people/:id/milestones/new",
        loader: milestoneNewLoader("person"),
        element: <MilestoneCreate />,
        action: milestoneCreateAction("person"),
      },
      {
        path: "people/:id/milestones/:milestoneId/edit",
        loader: milestoneForBearerLoader("person"),
        element: <MilestoneEdit />,
        action: milestoneEditAction("person"),
      },
      {
        path: "people/:id/milestones/:milestoneId/delete",
        loader: milestoneForBearerLoader("person"),
        element: <MilestoneDelete />,
        action: milestoneDeleteAction("person"),
      },
      {
        path: "people/:id/milestones/:milestoneId/rebind",
        loader: milestoneRebindLoader,
        element: <MilestoneRebind />,
        action: milestoneRebindAction,
      },
      {
        path: "people/:id/contact/:kind/new",
        loader: contactNewLoader,
        element: <ContactMethodCreate />,
        action: contactCreateAction,
      },
      {
        path: "people/:id/contact/:kind/:methodId/edit",
        loader: contactMethodLoader,
        element: <ContactMethodEdit />,
        action: contactEditAction,
      },
      {
        path: "people/:id/contact/:kind/:methodId/delete",
        loader: contactMethodLoader,
        element: <ContactMethodDelete />,
        action: contactDeleteAction,
      },
      {
        path: "pets/new",
        loader: () => window.api.views.candidates(),
        element: <PetCreate />,
        action: async ({ request }) => {
          const formData = await request.formData();
          const pet = await window.api.pets.create(
            readPetInput(formData),
            readTags(formData),
          );
          await createRelationships("pet", pet.id, readRelationships(formData));
          return redirect(`/pets/${pet.id}`);
        },
      },
      {
        path: "pets/:id",
        loader: petLoader,
        element: <PetView />,
      },
      {
        path: "pets/:id/edit",
        loader: petLoader,
        element: <PetEdit />,
        action: async ({ request, params }) => {
          const formData = await request.formData();
          await window.api.pets.update(
            params.id as string,
            readPetInput(formData),
            readTags(formData),
          );
          return redirect(`/pets/${params.id}`);
        },
      },
      {
        path: "pets/:id/delete",
        loader: petLoader,
        element: <PetDelete />,
        action: async ({ params }) => {
          await window.api.pets.softDelete(params.id as string);
          return redirect("/people");
        },
      },
      {
        path: "pets/:id/relationships/new",
        loader: relationshipNewLoader("pet"),
        element: <RelationshipCreate />,
        action: relationshipCreateAction("pet"),
      },
      {
        path: "pets/:id/relationships/:relId/edit",
        loader: relationshipForSubjectLoader("pet"),
        element: <RelationshipEdit />,
        action: relationshipEditAction("pet"),
      },
      {
        path: "pets/:id/relationships/:relId/delete",
        loader: relationshipForSubjectLoader("pet"),
        element: <RelationshipDelete />,
        action: relationshipDeleteAction("pet"),
      },
      {
        path: "pets/:id/relationships/edit",
        loader: relationshipDerivedLoader("pet"),
        element: <RelationshipEdit />,
        action: relationshipDerivedEditAction("pet"),
      },
      {
        path: "pets/:id/relationships/dismiss",
        loader: relationshipDerivedLoader("pet"),
        element: <RelationshipDismiss />,
        action: relationshipDismissAction("pet"),
      },
      {
        path: "pets/:id/milestones/new",
        loader: milestoneNewLoader("pet"),
        element: <MilestoneCreate />,
        action: milestoneCreateAction("pet"),
      },
      {
        path: "pets/:id/milestones/:milestoneId/edit",
        loader: milestoneForBearerLoader("pet"),
        element: <MilestoneEdit />,
        action: milestoneEditAction("pet"),
      },
      {
        path: "pets/:id/milestones/:milestoneId/delete",
        loader: milestoneForBearerLoader("pet"),
        element: <MilestoneDelete />,
        action: milestoneDeleteAction("pet"),
      },
      {
        path: "relationships/:id",
        loader: relationshipViewLoader,
        element: <RelationshipView />,
      },
      {
        path: "relationships/:id/edit",
        loader: relationshipPartnersLoader,
        element: <RelationshipRolesEdit />,
        action: relationshipRolesEditAction,
      },
      {
        path: "relationships/:id/delete",
        loader: relationshipPartnersLoader,
        element: <RelationshipRowDelete />,
        action: relationshipRowDeleteAction,
      },
      {
        path: "relationships/:id/milestones/new",
        loader: milestoneNewLoader("relationship"),
        element: <MilestoneCreate />,
        action: milestoneCreateAction("relationship"),
      },
      {
        path: "relationships/:id/milestones/:milestoneId/edit",
        loader: milestoneForBearerLoader("relationship"),
        element: <MilestoneEdit />,
        action: milestoneEditAction("relationship"),
      },
      {
        path: "relationships/:id/milestones/:milestoneId/delete",
        loader: milestoneForBearerLoader("relationship"),
        element: <MilestoneDelete />,
        action: milestoneDeleteAction("relationship"),
      },
      {
        // The holiday catalog. Read-only: a catalog row is immutable by design,
        // and the user's levers (observe / hide) hang off it rather than editing
        // it.
        path: "holidays",
        loader: () => window.api.holidays.list(),
        element: <HolidayList />,
      },
      {
        path: "holidays/:id",
        loader: async ({ params }: LoaderFunctionArgs) => {
          const id = params.id as string;
          const [holiday, candidates] = await Promise.all([
            window.api.holidays.get(id),
            window.api.holidays.listObservers(id),
          ]);
          if (!holiday) {
            throw new Response("Holiday not found", { status: 404 });
          }
          // The whole address book with each answer: the screen splits it into
          // the observers it lists and the pool its add-field suggests from.
          return { holiday, candidates };
        },
        element: <HolidayView />,
        action: async ({ params, request }: ActionFunctionArgs) => {
          // Hide / unhide. A catalog row is read-only, so suppressing it is the
          // user's only lever over the holiday itself.
          const formData = await request.formData();
          await window.api.holidays.setHidden(
            params.id as string,
            formData.get("hidden") === "true",
          );
          return null;
        },
      },
      {
        // One observance's reminder schedule. Per-observance rather than
        // per-holiday because the rule's bearer is the observance — the seam
        // that lets two people who observe the same holiday be reminded about
        // entirely different things.
        path: "holidays/:id/observers/:bearerType/:bearerId",
        loader: async ({ params }: LoaderFunctionArgs) => {
          const id = params.id as string;
          const bearerType = params.bearerType as "person" | "pet";
          const bearerId = params.bearerId as string;
          const [holiday, candidates, schedule] = await Promise.all([
            window.api.holidays.get(id),
            window.api.holidays.listObservers(id),
            window.api.holidays.getObservanceSchedule(id, bearerType, bearerId),
          ]);
          if (!holiday) {
            throw new Response("Holiday not found", { status: 404 });
          }
          const observer = candidates.find(
            (c) => c.bearerType === bearerType && c.bearerId === bearerId,
          );
          if (!observer) {
            throw new Response("Person not found", { status: 404 });
          }
          return {
            holiday,
            label: observer.label,
            bearerType,
            bearerId,
            schedule,
          };
        },
        element: <HolidayObservanceSchedule />,
        action: async ({ params, request }: ActionFunctionArgs) => {
          const formData = await request.formData();
          const rules = readReminderSchedule(formData) ?? [];
          await window.api.holidays.setObservanceSchedule(
            params.id as string,
            String(formData.get("bearerType")) as "person" | "pet",
            String(formData.get("bearerId")),
            rules,
          );
          return redirect(`/holidays/${params.id}`);
        },
      },
      {
        path: "tags/:id",
        loader: async ({ params }: LoaderFunctionArgs) => {
          const id = params.id as string;
          const tag = await window.api.tags.get(id);
          if (!tag) throw new Response("Tag not found", { status: 404 });
          const [people, pets, reminders, giftIdeas] = await Promise.all([
            window.api.tags.peopleForTag(id),
            window.api.tags.petsForTag(id),
            window.api.tags.remindersForTag(id),
            window.api.tags.giftIdeasForTag(id),
          ]);
          return { tag, people, pets, reminders, giftIdeas };
        },
        element: <TagView />,
      },
      {
        path: "tags/:id/delete",
        loader: async ({ params }: LoaderFunctionArgs) => {
          const id = params.id as string;
          const tag = await window.api.tags.get(id);
          if (!tag) throw new Response("Tag not found", { status: 404 });
          const [people, pets, reminders, giftIdeas] = await Promise.all([
            window.api.tags.peopleForTag(id),
            window.api.tags.petsForTag(id),
            window.api.tags.remindersForTag(id),
            window.api.tags.giftIdeasForTag(id),
          ]);
          return {
            tag,
            count:
              people.length + pets.length + reminders.length + giftIdeas.length,
          };
        },
        element: <TagDelete />,
        action: async ({ params }) => {
          await window.api.tags.softDelete(params.id as string);
          return redirect("/people");
        },
      },
    ],
  },
];

/**
 * Build the renderer's data router. Constructed **lazily** by the boot gate
 * (`main.tsx`) rather than at module load, because `createHashRouter` runs the
 * initial route's loader *eagerly* on creation. Building it before the main
 * process has opened the DB and registered its IPC — a window that only opens
 * during a slow, human-paced recovery boot — makes the index `views.entityList`
 * load reject ("No handler registered") and the router opens straight into
 * `ErrorPage` even though recovery succeeded. Deferring creation until the core
 * is live closes that race.
 */
export const createAppRouter = (): ReturnType<typeof createHashRouter> =>
  createHashRouter(routes);
