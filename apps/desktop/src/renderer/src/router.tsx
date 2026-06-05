import {
  type CreateMilestoneInput,
  type CreatePersonInput,
  type CreatePetInput,
  type EntityType,
  type Gender,
  type MilestoneKind,
  type MilestoneSubjectType,
  type Relationship,
  type RelationshipRole,
  type UpdateMilestoneInput,
  baseRole,
  createMilestoneInputSchema,
  createRelationshipInputSchema,
  genderedVariant,
  impliedGender,
  inverseRole,
  parseTagNames,
  preferredSubjectType,
  roleDefs,
  updateMilestoneInputSchema,
  updateRelationshipInputSchema,
} from "@leapsake/schema";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  createHashRouter,
  redirect,
} from "react-router-dom";
import { App } from "./App";
import type { RelationshipCandidate } from "./components/RelationshipForm";
import { entityBasePath, entityLabel } from "./lib/entityLabel";
import { fullName } from "./lib/fullName";
import { type EntityRow, EntityList } from "./screens/EntityList";
import { ErrorPage } from "./screens/ErrorPage";
import { PersonCreate } from "./screens/PersonCreate";
import { PersonDelete } from "./screens/PersonDelete";
import { PersonEdit } from "./screens/PersonEdit";
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

/** Pull the editable milestone fields (kind + partial date + note) out of a form. */
function readMilestoneFields(formData: FormData) {
  return {
    kind: String(formData.get("kind")) as MilestoneKind,
    year: readDatePart(formData, "year"),
    month: readDatePart(formData, "month"),
    day: readDatePart(formData, "day"),
    note: readNote(formData, "note"),
  };
}

/** Fetch a subject entity (person or pet) by id, or undefined if missing. */
function getEntity(type: EntityType, id: string) {
  return type === "person"
    ? window.api.people.get(id)
    : window.api.pets.get(id);
}

/** A milestone subject (person, pet, or relationship) resolved for display. */
interface MilestoneSubject {
  type: MilestoneSubjectType;
  id: string;
  label: string;
}

/** Resolve a person/pet to its display label, or a placeholder when it's gone. */
async function resolveEntityLabel(
  type: EntityType,
  id: string,
): Promise<string> {
  const entity = await getEntity(type, id);
  return entity ? entityLabel(type, entity) : "(unknown)";
}

/** A relationship's two-sided label from its endpoints, e.g. "Jane Doe & John Doe". */
async function relationshipLabel(rel: Relationship): Promise<string> {
  const [a, b] = await Promise.all([
    resolveEntityLabel(rel.aType, rel.aId),
    resolveEntityLabel(rel.bType, rel.bId),
  ]);
  return `${a} & ${b}`;
}

/**
 * Resolve a milestone subject (person, pet, or relationship) to a `{type, id,
 * label}` for the milestone screens' breadcrumbs/headers, or undefined when it
 * is missing. A relationship is labelled from its two endpoints.
 */
async function getMilestoneSubject(
  subjectType: MilestoneSubjectType,
  id: string,
): Promise<MilestoneSubject | undefined> {
  if (subjectType === "relationship") {
    const rel = await window.api.relationships.get(id);
    return rel
      ? { type: subjectType, id, label: await relationshipLabel(rel) }
      : undefined;
  }
  const entity = await getEntity(subjectType, id);
  return entity
    ? { type: subjectType, id, label: entityLabel(subjectType, entity) }
    : undefined;
}

/**
 * All people and pets as relationship candidates, optionally excluding one
 * entity (the subject, when adding from its own page). Shared by the standalone
 * add-relationship loader and the create-form loaders.
 */
async function listCandidates(exclude?: {
  type: EntityType;
  id: string;
}): Promise<RelationshipCandidate[]> {
  const [people, pets] = await Promise.all([
    window.api.people.list(),
    window.api.pets.list(),
  ]);
  return [
    ...people
      .filter((p) => !(exclude?.type === "person" && p.id === exclude.id))
      .map((p) => ({ type: "person" as const, id: p.id, label: fullName(p) })),
    ...pets
      .filter((p) => !(exclude?.type === "pet" && p.id === exclude.id))
      .map((p) => ({ type: "pet" as const, id: p.id, label: p.name })),
  ];
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
 * Persist the relationship rows for a just-created subject. The subject is the
 * `a` endpoint; its own role is the implied inverse of the picked b-side role.
 */
async function createRelationships(
  subjectType: EntityType,
  subjectId: string,
  drafts: RelationshipDraft[],
) {
  for (const draft of drafts) {
    const input = createRelationshipInputSchema.parse({
      aType: subjectType,
      aId: subjectId,
      aRole: inverseRole(draft.bRole),
      bType: draft.bType,
      bId: draft.bId,
      bRole: draft.bRole,
      bRoleNote: draft.bRoleNote,
    });
    await window.api.relationships.create(input);
  }
}

/** The combined People & Pets home list, merged and sorted by display name. */
async function entityListLoader(): Promise<EntityRow[]> {
  const [people, pets] = await Promise.all([
    window.api.people.list(),
    window.api.pets.list(),
  ]);
  const rows: EntityRow[] = [
    ...people.map((p) => ({
      type: "person" as const,
      id: p.id,
      label: fullName(p),
    })),
    ...pets.map((p) => ({ type: "pet" as const, id: p.id, label: p.name })),
  ];
  return rows.toSorted((a, b) => a.label.localeCompare(b.label));
}

/** A Person plus its tags, derived gender, and neighbors (explicit + derived). */
async function personLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const person = await window.api.people.get(id);
  if (!person) throw new Response("Person not found", { status: 404 });
  const [tags, relationships, gender, timeline] = await Promise.all([
    window.api.tags.listForPerson(id),
    window.api.kinship.neighborsFor("person", id),
    window.api.kinship.genderFor("person", id),
    window.api.milestones.timelineFor("person", id),
  ]);
  return { person, tags, relationships, gender, timeline };
}

/** A Pet plus its tags, derived gender, and neighbors (explicit + derived). */
async function petLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const pet = await window.api.pets.get(id);
  if (!pet) throw new Response("Pet not found", { status: 404 });
  const [tags, relationships, gender, timeline] = await Promise.all([
    window.api.tags.listForPet(id),
    window.api.kinship.neighborsFor("pet", id),
    window.api.kinship.genderFor("pet", id),
    window.api.milestones.timelineFor("pet", id),
  ]);
  return { pet, tags, relationships, gender, timeline };
}

/**
 * Loader for the "add relationship" screen of either entity type. Resolves the
 * subject and builds the candidate list from *both* people and pets (the subject
 * itself excluded), so any entity can relate to any other; the role pickers then
 * constrain owner/pet by holder type.
 */
function relationshipNewLoader(subjectType: EntityType) {
  return async ({ params }: LoaderFunctionArgs) => {
    const id = params.id as string;
    const subject = await getEntity(subjectType, id);
    if (!subject) throw new Response("Not found", { status: 404 });

    const candidates = await listCandidates({ type: subjectType, id });

    return {
      subject: {
        type: subjectType,
        id,
        label: entityLabel(subjectType, subject),
      },
      candidates,
    };
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
    const id = params.id as string;
    const relId = params.relId as string;
    const subject = await getEntity(subjectType, id);
    if (!subject) throw new Response("Not found", { status: 404 });
    const neighbors = await window.api.relationships.listForEntity(
      subjectType,
      id,
    );
    const neighbor = neighbors.find((n) => n.relationshipId === relId);
    if (!neighbor)
      throw new Response("Relationship not found", { status: 404 });
    return {
      subject: {
        type: subjectType,
        id,
        label: entityLabel(subjectType, subject),
      },
      neighbor,
    };
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
    const relId = params.relId as string;
    const formData = await request.formData();
    const otherRole = String(formData.get("otherRole")) as RelationshipRole;
    const otherRoleNote = readNote(formData, "otherRoleNote");

    const rel = await window.api.relationships.get(relId);
    if (!rel) throw new Response("Relationship not found", { status: 404 });
    const subjectIsA = rel.aType === subjectType && rel.aId === id;

    // Only the other end's role is edited; the subject's own role re-derives as
    // the neutral inverse, but keeps the gendering it already had (so editing a
    // wife→husband couple doesn't flatten the unedited "husband" back to "spouse").
    const subjectRole = genderedVariant(
      inverseRole(otherRole),
      impliedGender(subjectIsA ? rel.aRole : rel.bRole),
    );

    const input = updateRelationshipInputSchema.parse(
      subjectIsA
        ? {
            aRole: subjectRole,
            aRoleNote: null,
            bRole: otherRole,
            bRoleNote: otherRoleNote,
          }
        : {
            aRole: otherRole,
            aRoleNote: otherRoleNote,
            bRole: subjectRole,
            bRoleNote: null,
          },
    );
    await window.api.relationships.update(relId, input);
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
    const id = params.id as string;
    const subject = await getEntity(subjectType, id);
    if (!subject) throw new Response("Not found", { status: 404 });

    const url = new URL(request.url);
    const otherType = url.searchParams.get("otherType") as EntityType | null;
    const otherId = url.searchParams.get("otherId");
    const role = url.searchParams.get("role") as RelationshipRole | null;
    if (!otherType || !otherId || !role)
      throw new Response("Bad derived-relationship request", { status: 400 });

    const neighbors = await window.api.kinship.neighborsFor(subjectType, id);
    const neighbor = neighbors.find(
      (n) =>
        n.origin === "derived" &&
        n.otherType === otherType &&
        n.otherId === otherId &&
        baseRole(n.otherRole) === role,
    );
    if (!neighbor)
      throw new Response("Derived relationship not found", { status: 404 });

    return {
      subject: {
        type: subjectType,
        id,
        label: entityLabel(subjectType, subject),
      },
      neighbor,
      role,
    };
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
    const otherRole = String(formData.get("otherRole")) as RelationshipRole;
    const input = createRelationshipInputSchema.parse({
      aType: subjectType,
      aId: id,
      aRole: inverseRole(otherRole),
      bType: otherType,
      bId: otherId,
      bRole: otherRole,
      bRoleNote: readNote(formData, "otherRoleNote"),
    });
    await window.api.relationships.create(input);
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
function milestoneNewLoader(subjectType: MilestoneSubjectType) {
  return async ({ params }: LoaderFunctionArgs) => {
    const id = params.id as string;
    const subject = await getMilestoneSubject(subjectType, id);
    if (!subject) throw new Response("Not found", { status: 404 });
    if (subjectType !== "person") return { subject };
    const [candidates, neighbors] = await Promise.all([
      listCandidates({ type: "person", id }),
      window.api.relationships.listForEntity("person", id),
    ]);
    return { subject, candidates, neighbors };
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
): Promise<{ subjectType: MilestoneSubjectType; subjectId: string } | null> {
  const mode = String(formData.get("relMode") ?? "");
  if (mode === "bind") {
    return {
      subjectType: "relationship",
      subjectId: String(formData.get("relId")),
    };
  }
  if (mode === "create") {
    const bRole = String(formData.get("relRole")) as RelationshipRole;
    const rel = await window.api.relationships.create(
      createRelationshipInputSchema.parse({
        aType: "person",
        aId: personId,
        aRole: inverseRole(bRole),
        bType: String(formData.get("withType")),
        bId: String(formData.get("withId")),
        bRole,
      }),
    );
    return { subjectType: "relationship", subjectId: rel.id };
  }
  if (mode === "unbound") {
    return { subjectType: "person", subjectId: personId };
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
function milestoneCreateAction(subjectType: MilestoneSubjectType) {
  return async ({ request, params }: ActionFunctionArgs) => {
    const id = params.id as string;
    const formData = await request.formData();
    const fields = readMilestoneFields(formData);

    let subject: { subjectType: MilestoneSubjectType; subjectId: string } = {
      subjectType,
      subjectId: id,
    };
    if (
      subjectType === "person" &&
      preferredSubjectType(fields.kind) === "relationship"
    ) {
      const resolved = await resolveWithWhom(id, formData);
      if (!resolved) return redirect(`${entityBasePath(subjectType)}/${id}`);
      subject = resolved;
    }

    const input: CreateMilestoneInput = createMilestoneInputSchema.parse({
      ...subject,
      ...fields,
    });
    await window.api.milestones.create(input);
    return redirect(`${entityBasePath(subjectType)}/${id}`);
  };
}

/**
 * Loader for the milestone edit/delete screens: resolves the subject and finds
 * the milestone among the subject's list (there is no get-by-id IPC; the list
 * is already scoped + soft-delete-aware, mirroring the relationship screens).
 */
function milestoneForSubjectLoader(subjectType: MilestoneSubjectType) {
  return async ({ params }: LoaderFunctionArgs) => {
    const id = params.id as string;
    const milestoneId = params.milestoneId as string;
    const subject = await getMilestoneSubject(subjectType, id);
    if (!subject) throw new Response("Not found", { status: 404 });
    const milestones = await window.api.milestones.listForSubject(
      subjectType,
      id,
    );
    const milestone = milestones.find((m) => m.id === milestoneId);
    if (!milestone) throw new Response("Milestone not found", { status: 404 });
    return { subject, milestone };
  };
}

/** Action for the milestone edit screen: updates the editable fields. */
function milestoneEditAction(subjectType: MilestoneSubjectType) {
  return async ({ request, params }: ActionFunctionArgs) => {
    const id = params.id as string;
    const formData = await request.formData();
    const input: UpdateMilestoneInput = updateMilestoneInputSchema.parse(
      readMilestoneFields(formData),
    );
    await window.api.milestones.update(params.milestoneId as string, input);
    return redirect(`${entityBasePath(subjectType)}/${id}`);
  };
}

/** Action for the "remove milestone" screen. */
function milestoneDeleteAction(subjectType: MilestoneSubjectType) {
  return async ({ params }: ActionFunctionArgs) => {
    await window.api.milestones.softDelete(params.milestoneId as string);
    return redirect(`${entityBasePath(subjectType)}/${params.id}`);
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
  const subject = await getMilestoneSubject("person", id);
  if (!subject) throw new Response("Not found", { status: 404 });
  const milestones = await window.api.milestones.listForSubject("person", id);
  const milestone = milestones.find((m) => m.id === milestoneId);
  if (!milestone) throw new Response("Milestone not found", { status: 404 });
  const [candidates, neighbors] = await Promise.all([
    listCandidates({ type: "person", id }),
    window.api.relationships.listForEntity("person", id),
  ]);
  return { subject, milestone, candidates, neighbors };
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
  if (resolved && resolved.subjectType === "relationship") {
    await window.api.milestones.update(milestoneId, {
      subjectType: resolved.subjectType,
      subjectId: resolved.subjectId,
    });
  }
  return redirect(`/people/${id}`);
}

/**
 * Loader for the relationship detail page — the canonical home for a
 * relationship's milestones. Resolves the stored edge, both endpoint labels, and
 * the relationship-subject milestones.
 */
async function relationshipViewLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const relationship = await window.api.relationships.get(id);
  if (!relationship)
    throw new Response("Relationship not found", { status: 404 });
  const [aLabel, bLabel, milestones] = await Promise.all([
    resolveEntityLabel(relationship.aType, relationship.aId),
    resolveEntityLabel(relationship.bType, relationship.bId),
    window.api.milestones.listForSubject("relationship", id),
  ]);
  const partners = [
    {
      type: relationship.aType,
      id: relationship.aId,
      label: aLabel,
      roleLabel: roleDefs[relationship.aRole].label,
    },
    {
      type: relationship.bType,
      id: relationship.bId,
      label: bLabel,
      roleLabel: roleDefs[relationship.bRole].label,
    },
  ];
  return { relationship, partners, title: `${aLabel} & ${bLabel}`, milestones };
}

/** One endpoint of a relationship, resolved for the relationship-scoped edit/delete screens. */
interface RelationshipPartner {
  type: EntityType;
  id: string;
  label: string;
  role: RelationshipRole;
  roleLabel: string;
  roleNote: string | null;
}

/**
 * Loader for the relationship-scoped edit/delete screens. Unlike the
 * subject-scoped relationship screens (reached from a Person/Pet, which edit only
 * the *other* end), these operate on the relationship as a whole — both endpoints
 * resolved with their own role — so the user can set each side's role explicitly
 * and a delete plainly removes the single shared row.
 */
async function relationshipPartnersLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const relationship = await window.api.relationships.get(id);
  if (!relationship)
    throw new Response("Relationship not found", { status: 404 });
  const [aLabel, bLabel] = await Promise.all([
    resolveEntityLabel(relationship.aType, relationship.aId),
    resolveEntityLabel(relationship.bType, relationship.bId),
  ]);
  const partners: [RelationshipPartner, RelationshipPartner] = [
    {
      type: relationship.aType,
      id: relationship.aId,
      label: aLabel,
      role: relationship.aRole,
      roleLabel: roleDefs[relationship.aRole].label,
      roleNote: relationship.aRoleNote,
    },
    {
      type: relationship.bType,
      id: relationship.bId,
      label: bLabel,
      role: relationship.bRole,
      roleLabel: roleDefs[relationship.bRole].label,
      roleNote: relationship.bRoleNote,
    },
  ];
  return { relationshipId: id, title: `${aLabel} & ${bLabel}`, partners };
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
  return redirect(rel ? `${entityBasePath(rel.aType)}/${rel.aId}` : "/");
}

/**
 * The renderer's route tree. We use the data-router pattern (loaders for reads,
 * actions + `<Form>` for writes) so navigation, data, and mutations are modeled
 * the same way the eventual server-rendered web app will model them in
 * react-router framework mode — the desktop client just swaps `createHashRouter`
 * (required under Electron's `file://` load) for the server entry.
 */
export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    errorElement: <ErrorPage />,
    children: [
      {
        index: true,
        loader: entityListLoader,
        element: <EntityList />,
      },
      {
        path: "people/new",
        loader: () => listCandidates(),
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
          return redirect("/");
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
        loader: milestoneForSubjectLoader("person"),
        element: <MilestoneEdit />,
        action: milestoneEditAction("person"),
      },
      {
        path: "people/:id/milestones/:milestoneId/delete",
        loader: milestoneForSubjectLoader("person"),
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
        path: "pets/new",
        loader: () => listCandidates(),
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
          return redirect("/");
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
        loader: milestoneForSubjectLoader("pet"),
        element: <MilestoneEdit />,
        action: milestoneEditAction("pet"),
      },
      {
        path: "pets/:id/milestones/:milestoneId/delete",
        loader: milestoneForSubjectLoader("pet"),
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
        loader: milestoneForSubjectLoader("relationship"),
        element: <MilestoneEdit />,
        action: milestoneEditAction("relationship"),
      },
      {
        path: "relationships/:id/milestones/:milestoneId/delete",
        loader: milestoneForSubjectLoader("relationship"),
        element: <MilestoneDelete />,
        action: milestoneDeleteAction("relationship"),
      },
      {
        path: "tags/:id",
        loader: async ({ params }: LoaderFunctionArgs) => {
          const id = params.id as string;
          const tag = await window.api.tags.get(id);
          if (!tag) throw new Response("Tag not found", { status: 404 });
          const [people, pets] = await Promise.all([
            window.api.tags.peopleForTag(id),
            window.api.tags.petsForTag(id),
          ]);
          return { tag, people, pets };
        },
        element: <TagView />,
      },
      {
        path: "tags/:id/delete",
        loader: async ({ params }: LoaderFunctionArgs) => {
          const id = params.id as string;
          const tag = await window.api.tags.get(id);
          if (!tag) throw new Response("Tag not found", { status: 404 });
          const [people, pets] = await Promise.all([
            window.api.tags.peopleForTag(id),
            window.api.tags.petsForTag(id),
          ]);
          return { tag, count: people.length + pets.length };
        },
        element: <TagDelete />,
        action: async ({ params }) => {
          await window.api.tags.softDelete(params.id as string);
          return redirect("/");
        },
      },
    ],
  },
]);
