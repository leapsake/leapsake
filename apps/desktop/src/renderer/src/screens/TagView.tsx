import type { GiftIdea, Person, Pet, Reminder, Tag } from "@leapsake/schema";
import { fullName, reminderLabel, tagLabel } from "@leapsake/schema";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";

/** One row in a tag's grouped listing: a labelled link to an entity's page. */
function EntityRows({
  rows,
}: {
  rows: { id: string; label: string; to: string }[];
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <Link to={row.to}>{row.label}</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Everything carrying a given tag, grouped by type. People, Pets, Reminders, and
 * Gift ideas are all taggable; each group renders only when it has members, and
 * an empty tag shows a placeholder. Neither reminders nor gift ideas have a
 * standalone view on desktop, so their rows open their edit screens (the
 * actionable page for each here).
 */
export function TagView() {
  const { tag, people, pets, reminders, giftIdeas } = useLoaderData() as {
    tag: Tag;
    people: Person[];
    pets: Pet[];
    reminders: Reminder[];
    giftIdeas: GiftIdea[];
  };

  const empty =
    people.length === 0 &&
    pets.length === 0 &&
    reminders.length === 0 &&
    giftIdeas.length === 0;

  return (
    <main>
      <Breadcrumbs trail={[{ label: "Tags" }, { label: tagLabel(tag.name) }]} />

      <header>
        <h1>{tagLabel(tag.name)}</h1>
        <Link to={`/tags/${tag.id}/delete`}>Delete tag</Link>
      </header>

      {empty && <p>Nothing has this tag.</p>}

      {people.length > 0 && (
        <>
          <h2>People</h2>
          <EntityRows
            rows={people.map((person) => ({
              id: person.id,
              label: fullName(person),
              to: `/people/${person.id}`,
            }))}
          />
        </>
      )}

      {pets.length > 0 && (
        <>
          <h2>Pets</h2>
          <EntityRows
            rows={pets.map((pet) => ({
              id: pet.id,
              label: pet.name,
              to: `/pets/${pet.id}`,
            }))}
          />
        </>
      )}

      {reminders.length > 0 && (
        <>
          <h2>Reminders</h2>
          <EntityRows
            rows={reminders.map((reminder) => ({
              id: reminder.id,
              label: reminderLabel(reminder),
              to: `/reminders/${reminder.id}/edit`,
            }))}
          />
        </>
      )}

      {giftIdeas.length > 0 && (
        <>
          <h2>Gift ideas</h2>
          <EntityRows
            rows={giftIdeas.map((idea) => ({
              id: idea.id,
              label: idea.title,
              to: `/gifts/${idea.id}/edit`,
            }))}
          />
        </>
      )}
    </main>
  );
}
