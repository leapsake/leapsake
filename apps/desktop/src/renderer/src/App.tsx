import { type FormEvent, useEffect, useRef, useState } from "react";
import type { Person } from "@leapsake/schema";

export function App() {
  const [people, setPeople] = useState<Person[]>([]);
  const [editing, setEditing] = useState<Person | null>(null);
  const editDialog = useRef<HTMLDialogElement>(null);

  async function refresh(): Promise<void> {
    setPeople(await window.api.people.list());
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await window.api.people.create({
      firstName: String(data.get("firstName")),
      lastName: String(data.get("lastName")),
    });
    form.reset();
    await refresh();
  }

  function startEdit(person: Person): void {
    setEditing(person);
    editDialog.current?.showModal();
  }

  function cancelEdit(): void {
    editDialog.current?.close();
    setEditing(null);
  }

  async function handleEdit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    await window.api.people.update(editing.id, {
      firstName: String(data.get("firstName")),
      lastName: String(data.get("lastName")),
    });
    cancelEdit();
    await refresh();
  }

  async function handleDelete(id: string): Promise<void> {
    await window.api.people.softDelete(id);
    await refresh();
  }

  return (
    <main>
      <h1>People</h1>

      <form onSubmit={handleCreate}>
        <fieldset>
          <legend>Add a person</legend>
          <label>
            First name <input name="firstName" required />
          </label>{" "}
          <label>
            Last name <input name="lastName" required />
          </label>{" "}
          <button type="submit">Add</button>
        </fieldset>
      </form>

      {people.length === 0 ? (
        <p>No people yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Last name</th>
              <th>First name</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id}>
                <td>{person.lastName}</td>
                <td>{person.firstName}</td>
                <td>
                  <button type="button" onClick={() => startEdit(person)}>
                    Edit
                  </button>{" "}
                  <button type="button" onClick={() => handleDelete(person.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <dialog ref={editDialog} onClose={() => setEditing(null)}>
        {editing && (
          <form key={editing.id} onSubmit={handleEdit}>
            <fieldset>
              <legend>Edit person</legend>
              <label>
                First name{" "}
                <input
                  name="firstName"
                  defaultValue={editing.firstName}
                  required
                />
              </label>{" "}
              <label>
                Last name{" "}
                <input
                  name="lastName"
                  defaultValue={editing.lastName}
                  required
                />
              </label>{" "}
              <button type="submit">Save</button>{" "}
              <button type="button" onClick={cancelEdit}>
                Cancel
              </button>
            </fieldset>
          </form>
        )}
      </dialog>
    </main>
  );
}
