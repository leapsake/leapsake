import { type CreatePersonInput, parseTagNames } from "@leapsake/schema";
import {
  type LoaderFunctionArgs,
  createHashRouter,
  redirect,
} from "react-router-dom";
import { App } from "./App";
import { ErrorPage } from "./screens/ErrorPage";
import { PeopleList } from "./screens/PeopleList";
import { PersonCreate } from "./screens/PersonCreate";
import { PersonDelete } from "./screens/PersonDelete";
import { PersonEdit } from "./screens/PersonEdit";
import { PersonView } from "./screens/PersonView";
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

/** A Person plus its tags, loaded together for the view/edit/delete screens. */
async function personLoader({ params }: LoaderFunctionArgs) {
  const id = params.id as string;
  const person = await window.api.people.get(id);
  if (!person) throw new Response("Person not found", { status: 404 });
  const tags = await window.api.tags.listForPerson(id);
  return { person, tags };
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
