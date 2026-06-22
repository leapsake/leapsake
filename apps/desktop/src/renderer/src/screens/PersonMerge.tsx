import type { Person } from "@leapsake/schema";
import { fullName } from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";

/**
 * Merge a duplicate person into the one being viewed. The viewed person is the
 * **survivor** — its name and other scalar fields are kept — and the chosen
 * person is the **duplicate**, whose relationships, tags, milestones, contact
 * methods, and dismissals all move onto the survivor before it is removed.
 *
 * This mirrors the dangerous-action confirm pattern (a dedicated screen with an
 * explicit submit), and is honest that it can't be undone: the duplicate is
 * tombstoned, not archived.
 */
export function PersonMerge() {
  const { person, others, defaultLoserId } = useLoaderData() as {
    person: Person;
    others: Person[];
    defaultLoserId?: string;
  };
  const name = fullName(person);
  const navigation = useNavigation();
  const merging = navigation.state === "submitting";

  return (
    <main>
      <Breadcrumbs
        trail={[homeCrumb, { label: name, to: `/people/${person.id}` }]}
      />
      <h1>Merge another person into {name}?</h1>

      {others.length === 0 ? (
        <p>
          There is no one else to merge in.{" "}
          <Link to={`/people/${person.id}`}>Back</Link>
        </p>
      ) : (
        <>
          <p>
            Everything attached to the person you pick — relationships, tags,
            milestones, contact methods — moves onto <strong>{name}</strong>,
            and that duplicate is then deleted.{" "}
            <strong>This can't be undone.</strong>
          </p>
          <Form method="post">
            <fieldset disabled={merging}>
              <label>
                Duplicate to merge in{" "}
                <select
                  name="loserId"
                  required
                  defaultValue={defaultLoserId ?? ""}
                >
                  <option value="" disabled>
                    Choose a person…
                  </option>
                  {others.map((other) => (
                    <option key={other.id} value={other.id}>
                      {fullName(other)}
                    </option>
                  ))}
                </select>
              </label>{" "}
              <button type="submit">Merge</button>{" "}
              <Link to={`/people/${person.id}`}>Cancel</Link>
            </fieldset>
          </Form>
        </>
      )}
    </main>
  );
}
