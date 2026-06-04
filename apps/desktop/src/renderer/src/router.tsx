import {
  type CreatePersonInput,
  createRelationshipInputSchema,
  parseTagNames,
} from "@leapsake/schema";
import {
  type LoaderFunctionArgs,
  createHashRouter,
  redirect,
} from "react-router-dom";
import { App } from "./App";
import { fullName } from "./lib/fullName";
import { ErrorPage } from "./screens/ErrorPage";
import { PeopleList } from "./screens/PeopleList";
import { PersonCreate } from "./screens/PersonCreate";
import { PersonDelete } from "./screens/PersonDelete";
import { PersonEdit } from "./screens/PersonEdit";
import { PersonView } from "./screens/PersonView";
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
        loader: () => window.api.people.list(),
        element: <PeopleList />,
      },
      {
        path: "people/new",
        element: <PersonCreate />,
        action: async ({ request }) => {
          const formData = await request.formData();
          await window.api.people.create(
            readPersonInput(formData),
            readTags(formData),
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
        loader: async ({ params }: LoaderFunctionArgs) => {
          const id = params.id as string;
          const subject = await window.api.people.get(id);
          if (!subject) throw new Response("Person not found", { status: 404 });
          const people = await window.api.people.list();
          const candidates = people
            .filter((person) => person.id !== id)
            .map((person) => ({
              type: "person" as const,
              id: person.id,
              label: fullName(person),
            }));
          return {
            subject: { type: "person" as const, id, label: fullName(subject) },
            candidates,
          };
        },
        element: <RelationshipCreate />,
        action: async ({ request, params }) => {
          const id = params.id as string;
          const formData = await request.formData();
          const input = createRelationshipInputSchema.parse({
            aType: "person",
            aId: id,
            aRole: String(formData.get("aRole")),
            aRoleNote: readNote(formData, "aRoleNote"),
            bType: String(formData.get("bType")),
            bId: String(formData.get("bId")),
            bRole: String(formData.get("bRole")),
            bRoleNote: readNote(formData, "bRoleNote"),
          });
          await window.api.relationships.create(input);
          return redirect(`/people/${id}`);
        },
      },
      {
        path: "people/:id/relationships/:relId/delete",
        loader: async ({ params }: LoaderFunctionArgs) => {
          const id = params.id as string;
          const relId = params.relId as string;
          const person = await window.api.people.get(id);
          if (!person) throw new Response("Person not found", { status: 404 });
          const neighbors = await window.api.relationships.listForEntity(
            "person",
            id,
          );
          const neighbor = neighbors.find((n) => n.relationshipId === relId);
          if (!neighbor)
            throw new Response("Relationship not found", { status: 404 });
          return { person, neighbor };
        },
        element: <RelationshipDelete />,
        action: async ({ params }) => {
          await window.api.relationships.softDelete(params.relId as string);
          return redirect(`/people/${params.id}`);
        },
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
