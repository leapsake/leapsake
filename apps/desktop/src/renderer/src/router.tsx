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
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type RouteObject,
  createHashRouter,
  redirect,
} from "react-router-dom";
import { App } from "./App";
import { ContactMethodCreate } from "./screens/ContactMethodCreate";
import { ContactMethodDelete } from "./screens/ContactMethodDelete";
import { ContactMethodEdit } from "./screens/ContactMethodEdit";
import { entityBasePath } from "./lib/entityLabel";
import { EntityList } from "./screens/EntityList";
import { ErrorPage } from "./screens/ErrorPage";
import { PersonCreate } from "./screens/PersonCreate";
import { PersonDelete } from "./screens/PersonDelete";
import { PersonEdit } from "./screens/PersonEdit";
import { PersonMerge } from "./screens/PersonMerge";
import { Duplicates } from "./screens/Duplicates";
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
import { ReminderList } from "./screens/ReminderList";
import { Settings } from "./screens/Settings";
import { TagDelete } from "./screens/TagDelete";
import { TagView } from "./screens/TagView";

/** Parse the Gender select: the empty option means "unset" (null). */
function readGender(formData: FormData): Gender | null {
  const value = String(formData.get("gender") ?? "");
  return value === "" ? null : (value as Gender);
}

/** Pull the editable Person fields out of a submitted form. */
function readPersonInput(formData: FormData): CreatePersonInput {
  const middleName = String(formData.get("middleName")).trim();
  return {
    firstName: String(formData.get("firstName")),
    middleName: middleName.length > 0 ? middleName : null,
    lastName: String(formData.get("lastName")),
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
 * Parse the milestone's staggered-reminder schedule out of the form's hidden
 * JSON field. Absent (older form / no field) leaves the stored rules untouched;
 * a present array (possibly empty) replaces them. Core + the repo re-validate.
 */
function readReminderSchedule(
  formData: FormData,
): ReminderRuleInput[] | undefined {
  const raw = formData.get("reminderSchedule");
  if (raw === null) return undefined;
  const parsed = JSON.parse(String(raw)) as unknown;
  return Array.isArray(parsed) ? (parsed as ReminderRuleInput[]) : undefined;
}

/** Pull the editable milestone fields (kind + partial date + note + reminders) out of a form. */
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

/**
 * Persist the relationship rows for a just-created subject. Core implies the
 * subject's own role from each picked b-side role, so the action only forwards
 * the parsed draft.
 */
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

/** The combined People & Pets home list, merged and sorted by display name. */
function entityListLoader() {
  return window.api.views.entityList();
}

/**
 * A Person plus its tags, derived gender, and neighbors (explicit + derived),
 * alongside the reminders that `@mention` them — the backlink the view lists in
 * its "Mentioned in" section, loaded in parallel with the view itself.
 */
async function personLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const [view, mentionedIn] = await Promise.all([
    window.api.views.person(id),
    window.api.reminders.mentioning("person", id),
  ]);
  if (!view) throw new Response("Person not found", { status: 404 });
  return { ...view, mentionedIn };
}

/**
 * A Pet plus its tags, derived gender, and neighbors (explicit + derived),
 * alongside the reminders that `@mention` it — the "Mentioned in" backlink,
 * loaded in parallel with the view itself.
 */
async function petLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const [view, mentionedIn] = await Promise.all([
    window.api.views.pet(id),
    window.api.reminders.mentioning("pet", id),
  ]);
  if (!view) throw new Response("Pet not found", { status: 404 });
  return { ...view, mentionedIn };
}

/**
 * Loader for the "add relationship" screen of either entity type. Resolves the
 * subject and builds the candidate list from *both* people and pets (the subject
 * itself excluded), so any entity can relate to any other; the role pickers then
 * constrain owner/pet by holder type.
 */
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

/** Action for the "add relationship" screen: the subject endpoint comes from the route. */
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

/**
 * Loader for the relationship edit/remove screens, oriented to the subject. The
 * stored (explicit) edge is found among the subject's neighbors by id — there is
 * no get-oriented-by-id IPC, so we reuse the already subject-scoped list, the
 * same shape the milestone edit/delete loader uses.
 */
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

/**
 * Action for the "edit relationship" screen. Only the other end's role changes;
 * the subject's own role is re-derived as the neutral inverse (mirroring the add
 * flow). The stored row may hold the subject as either endpoint, so we fetch it
 * to learn the orientation before mapping the new roles onto a/b.
 */
function relationshipEditAction(subjectType: EntityType) {
  return async ({ request, params }: ActionFunctionArgs) => {
    const id = params.id as string;
    const formData = await request.formData();
    // Core re-derives the subject's own role (neutral inverse, gendering kept)
    // from the edited other-end role; the app only forwards the parsed fields.
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

/** Action for the "remove relationship" screen. */
function relationshipDeleteAction(subjectType: EntityType) {
  return async ({ params }: ActionFunctionArgs) => {
    await window.api.relationships.softDelete(params.relId as string);
    return redirect(`${entityBasePath(subjectType)}/${params.id}`);
  };
}

/**
 * Loader for the derived-relationship edit/dismiss screens. A derived edge has no
 * stored row, so its identity travels in the query string (other endpoint + base
 * role); we recompute the subject's neighbors and find the matching derived one
 * to show its details. Shared by Edit and Remove so a derived edge presents the
 * same way an explicit one does.
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
 * Action for the "edit derived relationship" screen. A derived edge has no stored
 * row, so editing it *materialises* it: we create an explicit relationship with
 * the chosen role (the subject's own end is the implied neutral inverse, as in
 * the add flow). The new explicit edge then suppresses the derived one, so to the
 * user the relationship simply now carries the corrected role — indistinguishable
 * from any other stored edge.
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
    // Materialise the derived edge into an explicit one: core implies the
    // subject's own role from the chosen other role.
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

/** Action for the "dismiss derived relationship" screen. */
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
 * Loader for the "add milestone" screen. Resolves the subject (person, pet, or
 * relationship). From a **Person**, the relationship kinds (Met / First Date /
 * Wedding) need a "with whom?" step, so we also load the candidate list and the
 * person's existing explicit edges — used to bind to an existing relationship or
 * infer the spouse. Other subject types never offer those kinds.
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
 * Resolve the "with whom?" submission of a relationship-kind milestone added
 * from a Person into the subject the milestone hangs off: an existing
 * relationship (`bind`), a freshly created one (`create`), or the person itself
 * when the spouse is left unknown (`unbound`). Returns null when nothing was
 * chosen — the caller treats that as "cancel" for the kinds that require a
 * partner. Mirrors how {@link RelationshipForm} submits resolved machine values.
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
 * Action for the "add milestone" screen. The subject endpoint comes from the
 * route, except a relationship-kind (Met / First Date / Wedding) added from a
 * **Person**, which binds to / creates / (for Wedding) deliberately leaves
 * unbound a relationship per the form's resolved hidden fields. Met / First Date
 * require a partner: an empty resolution cancels the add (no row written).
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

/**
 * Loader for the milestone edit/delete screens: resolves the subject and finds
 * the milestone among the subject's list (there is no get-by-id IPC; the list
 * is already scoped + soft-delete-aware, mirroring the relationship screens).
 */
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
    // The milestone's resolved reminder schedule (its stored rules, else its
    // kind's defaults) prefills the edit form's Reminders section.
    const reminderSchedule = await window.api.milestones.reminderSchedule(
      milestoneId,
      milestone.kind,
    );
    return { bearer, milestone, reminderSchedule };
  };
}

/** Action for the milestone edit screen: updates the editable fields. */
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

/** Action for the "remove milestone" screen. */
function milestoneDeleteAction(bearerType: MilestoneBearerType) {
  return async ({ params }: ActionFunctionArgs) => {
    await window.api.milestones.softDelete(params.milestoneId as string);
    return redirect(`${entityBasePath(bearerType)}/${params.id}`);
  };
}

/**
 * Loader for the "set spouse / link to relationship" screen — rebinding an
 * unbound relationship-kind milestone (a Wedding stored on a Person while its
 * spouse was unknown) to a relationship. Resolves the person + milestone and the
 * same with-whom inputs the add flow uses.
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

/**
 * Action for the rebind screen: re-point an unbound milestone at a relationship
 * (existing or freshly created) via a normal `milestones.update` that changes
 * the subject. Rebind only ever targets a relationship; an empty/unbound
 * resolution is a no-op.
 */
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

/** Read the free-text contact-method label from the form, trimmed. */
function readContactLabel(formData: FormData): string {
  return String(formData.get("label") ?? "").trim();
}

/** Read an ISO alpha-2 country from the form: uppercased, blank → null. */
function readContactCountry(formData: FormData): string | null {
  const value = String(formData.get("country") ?? "")
    .trim()
    .toUpperCase();
  return value === "" ? null : value;
}

/** Resolve the owning Person for the contact-method screens, or 404. */
async function contactPersonSubject(id: string) {
  const person = await window.api.people.get(id);
  if (!person) throw new Response("Person not found", { status: 404 });
  return { id, label: fullName(person) };
}

/** Loader for the "add contact" screen: resolves the owner and the kind to add. */
async function contactNewLoader({ params }: LoaderFunctionArgs) {
  const subject = await contactPersonSubject(params.id as string);
  return { subject, kind: params.kind as ContactMethodKind };
}

/**
 * Loader for the contact edit/delete screens: resolves the owner and finds the
 * method among the owner's merged list (there is no get-by-id IPC; the list is
 * already owner-scoped and soft-delete-aware, mirroring the milestone screens).
 */
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

/**
 * Action for the "add contact" screen. The owner is the route's Person; the kind
 * (email / phone / postal) selects the typed sub-repo and which fields are read.
 * Blank optional fields become null; the country is uppercased to ISO shape.
 */
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

/** Action for the "edit contact" screen: updates the editable fields of one method. */
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

/** Action for the "remove contact" screen: soft-deletes one method by kind + id. */
async function contactDeleteAction({ params }: ActionFunctionArgs) {
  const kind = params.kind as ContactMethodKind;
  const methodId = params.methodId as string;
  if (kind === "email") {
    await window.api.contactMethods.emails.softDelete(methodId);
  } else if (kind === "phone") {
    await window.api.contactMethods.phones.softDelete(methodId);
  } else {
    await window.api.contactMethods.postals.softDelete(methodId);
  }
  return redirect(`/people/${params.id}`);
}

/**
 * Loader for the relationship detail page — the canonical home for a
 * relationship's milestones. Resolves the stored edge, both endpoint labels, and
 * the relationship-subject milestones.
 */
async function relationshipViewLoader({ params }: LoaderFunctionArgs) {
  const view = await window.api.views.relationship(params.id as string);
  if (!view) throw new Response("Relationship not found", { status: 404 });
  return view;
}

/**
 * Loader for the relationship-scoped edit/delete screens. Unlike the
 * subject-scoped relationship screens (reached from a Person/Pet, which edit only
 * the *other* end), these operate on the relationship as a whole — both endpoints
 * resolved with their own role — so the user can set each side's role explicitly
 * and a delete plainly removes the single shared row.
 */
async function relationshipPartnersLoader({ params }: LoaderFunctionArgs) {
  const view = await window.api.views.relationshipPartners(params.id as string);
  if (!view) throw new Response("Relationship not found", { status: 404 });
  return view;
}

/**
 * Action for the relationship-scoped "edit roles" screen: writes both endpoints'
 * roles exactly as picked. Unlike the subject-scoped edit, the two ends are
 * independent here — neither is auto-derived from the other — so the user can
 * make both explicit (e.g. Husband / Wife rather than Spouse / Husband).
 */
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

/**
 * Action for the relationship-scoped delete: soft-deletes the single shared row,
 * removing the relationship for both partners. The relationship page is now gone,
 * so we land on the first partner's entity page.
 */
async function relationshipRowDeleteAction({ params }: ActionFunctionArgs) {
  const id = params.id as string;
  const rel = await window.api.relationships.get(id);
  await window.api.relationships.softDelete(id);
  return redirect(rel ? `${entityBasePath(rel.aType)}/${rel.aId}` : "/people");
}

/**
 * The renderer's route tree. We use the data-router pattern (loaders for reads,
 * actions + `<Form>` for writes) so navigation, data, and mutations are modeled
 * the same way the eventual server-rendered web app will model them in
 * react-router framework mode — the desktop client just swaps `createHashRouter`
 * (required under Electron's `file://` load) for the server entry.
 */
/** Pull the editable reminder fields from a form; blank fields become null. */
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
    // The date input yields "YYYY-MM-DD" (or "" when cleared) → stored due epoch.
    dueDate: dueMsFromIso(String(formData.get("dueDate") ?? "")),
  };
}

/** Fetch a reminder by id for the edit/remove screens (404 when missing). */
async function reminderLoader({ params }: LoaderFunctionArgs) {
  const reminder = await window.api.reminders.get(params.id as string);
  if (!reminder) throw new Response("Reminder not found", { status: 404 });
  return reminder;
}

/**
 * Loader for the edit screen only: an automatic (`system`) reminder isn't
 * content-editable (the birthday engine owns its text), so bounce back to the list
 * rather than render a form whose save core would reject. The delete screen keeps
 * using {@link reminderLoader} directly — removing an automatic reminder is fine.
 */
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

/** Remove a reminder. */
async function reminderDeleteAction({ params }: ActionFunctionArgs) {
  await window.api.reminders.softDelete(params.id as string);
  return redirect("/reminders");
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
        element: <EntityList />,
      },
      {
        // Account & sync setup owns its own state (the one-time recovery-key
        // reveal must not survive a loader re-run), so no loader/action here.
        path: "settings",
        element: <Settings />,
      },
      {
        // Review duplicates: propose candidate pairs (reconciliation Increment
        // B). The "Not the same" action records the rejection and revalidates
        // this loader in place; "Merge…" routes into the people merge confirm.
        path: "duplicates",
        loader: () => window.api.duplicates.findCandidates(),
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
        loader: () => window.api.reminders.list(),
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
          return redirect(`/people/${person.id}`);
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
        path: "tags/:id",
        loader: async ({ params }: LoaderFunctionArgs) => {
          const id = params.id as string;
          const tag = await window.api.tags.get(id);
          if (!tag) throw new Response("Tag not found", { status: 404 });
          const [people, pets, reminders] = await Promise.all([
            window.api.tags.peopleForTag(id),
            window.api.tags.petsForTag(id),
            window.api.tags.remindersForTag(id),
          ]);
          return { tag, people, pets, reminders };
        },
        element: <TagView />,
      },
      {
        path: "tags/:id/delete",
        loader: async ({ params }: LoaderFunctionArgs) => {
          const id = params.id as string;
          const tag = await window.api.tags.get(id);
          if (!tag) throw new Response("Tag not found", { status: 404 });
          const [people, pets, reminders] = await Promise.all([
            window.api.tags.peopleForTag(id),
            window.api.tags.petsForTag(id),
            window.api.tags.remindersForTag(id),
          ]);
          return {
            tag,
            count: people.length + pets.length + reminders.length,
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
