import type { CreatePersonInput } from "@leapsake/schema";
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

/** Pull the editable Person fields out of a submitted form. */
function readPersonInput(formData: FormData): CreatePersonInput {
  const middleName = String(formData.get("middleName")).trim();
  return {
    firstName: String(formData.get("firstName")),
    middleName: middleName.length > 0 ? middleName : null,
    lastName: String(formData.get("lastName")),
  };
}

/** Load a single Person by route id, 404ing if it doesn't exist. */
async function personLoader({ params }: LoaderFunctionArgs) {
  const person = await window.api.people.get(params.id as string);
  if (!person) throw new Response("Person not found", { status: 404 });
  return person;
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
          await window.api.people.create(
            readPersonInput(await request.formData()),
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
          await window.api.people.update(
            params.id as string,
            readPersonInput(await request.formData()),
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
    ],
  },
]);
