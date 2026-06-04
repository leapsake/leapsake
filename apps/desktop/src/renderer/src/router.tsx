import {
  type CreatePersonInput,
  type CreatePetInput,
  type EntityType,
  type RelationshipRole,
  createRelationshipInputSchema,
  inverseRole,
  parseTagNames,
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
import { PersonView } from "./screens/PersonView";
import { PetCreate } from "./screens/PetCreate";
import { PetDelete } from "./screens/PetDelete";
import { PetEdit } from "./screens/PetEdit";
import { PetView } from "./screens/PetView";
import { RelationshipCreate } from "./screens/RelationshipCreate";
import { RelationshipDelete } from "./screens/RelationshipDelete";
import { TagView } from "./screens/TagView";

/** Pull the editable Person fields out of a submitted form. */
function readPersonInput(formData: FormData): CreatePersonInput {
  const middleName = String(formData.get("middleName")).trim();
  return {
    firstName: String(formData.get("firstName")),
    middleName: middleName.length > 0 ? middleName : null,
    lastName: String(formData.get("lastName")),
  };
}

/** Pull the editable Pet fields out of a submitted form. */
function readPetInput(formData: FormData): CreatePetInput {
  return { name: String(formData.get("name")) };
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

/** Fetch a subject entity (person or pet) by id, or undefined if missing. */
function getEntity(type: EntityType, id: string) {
  return type === "person"
    ? window.api.people.get(id)
    : window.api.pets.get(id);
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

/** A Person plus its tags and relationships, for the view/edit/delete screens. */
async function personLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const person = await window.api.people.get(id);
  if (!person) throw new Response("Person not found", { status: 404 });
  const tags = await window.api.tags.listForPerson(id);
  const relationships = await window.api.relationships.listForEntity(
    "person",
    id,
  );
  return { person, tags, relationships };
}

/** A Pet plus its relationships, for the view/edit/delete screens. */
async function petLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const pet = await window.api.pets.get(id);
  if (!pet) throw new Response("Pet not found", { status: 404 });
  const relationships = await window.api.relationships.listForEntity("pet", id);
  return { pet, relationships };
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

/** Loader for the "remove relationship" screen, oriented to the subject. */
function relationshipDeleteLoader(subjectType: EntityType) {
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

/** Action for the "remove relationship" screen. */
function relationshipDeleteAction(subjectType: EntityType) {
  return async ({ params }: ActionFunctionArgs) => {
    await window.api.relationships.softDelete(params.relId as string);
    return redirect(`${entityBasePath(subjectType)}/${params.id}`);
  };
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
          return redirect("/");
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
          return redirect("/");
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
        path: "people/:id/relationships/:relId/delete",
        loader: relationshipDeleteLoader("person"),
        element: <RelationshipDelete />,
        action: relationshipDeleteAction("person"),
      },
      {
        path: "pets/new",
        loader: () => listCandidates(),
        element: <PetCreate />,
        action: async ({ request }) => {
          const formData = await request.formData();
          const pet = await window.api.pets.create(readPetInput(formData));
          await createRelationships("pet", pet.id, readRelationships(formData));
          return redirect("/");
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
        path: "pets/:id/relationships/:relId/delete",
        loader: relationshipDeleteLoader("pet"),
        element: <RelationshipDelete />,
        action: relationshipDeleteAction("pet"),
      },
      {
        path: "tags/:id",
        loader: async ({ params }: LoaderFunctionArgs) => {
          const id = params.id as string;
          const tag = await window.api.tags.get(id);
          if (!tag) throw new Response("Tag not found", { status: 404 });
          const people = await window.api.tags.peopleForTag(id);
          return { tag, people };
        },
        element: <TagView />,
      },
    ],
  },
]);
