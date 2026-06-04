import type { Pet } from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";

export function PetDelete() {
  const { pet } = useLoaderData() as { pet: Pet };
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting";

  return (
    <main>
      <Breadcrumbs
        trail={[homeCrumb, { label: pet.name, to: `/pets/${pet.id}` }]}
      />
      <h1>Delete {pet.name}?</h1>
      <p>Are you sure you want to delete {pet.name}?</p>

      <Form method="post">
        <fieldset disabled={deleting}>
          <button type="submit">Delete</button>{" "}
          <Link to={`/pets/${pet.id}`}>Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
