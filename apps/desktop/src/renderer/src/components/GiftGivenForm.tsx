import type { GiftIdea } from "@leapsake/schema";
import { Form, Link, useNavigation } from "react-router-dom";

/**
 * The "log a giving" form. Pick an **existing** idea from the dropdown, or type a
 * **new** idea's title (which the create action mints in the same transaction — a
 * new title wins if both are filled). An optional what-happened date (year /
 * month / day, individually optional — the retro-log case, "Christmas 1941")
 * reuses the milestone partial-date shape. Giver defaults to you (the self-person)
 * in the action; occasion is a later UI increment. Uncontrolled — the route action
 * reads `FormData`.
 */
export function GiftGivenForm({
  ideas,
  cancelTo,
}: {
  ideas: GiftIdea[];
  cancelTo: string;
}) {
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  return (
    <Form method="post">
      <fieldset disabled={saving}>
        <p>
          <label htmlFor="gift-given-idea">Existing idea</label>
          <br />
          <select id="gift-given-idea" name="ideaId" defaultValue="">
            <option value="">— pick an existing idea —</option>
            {ideas.map((idea) => (
              <option key={idea.id} value={idea.id}>
                {idea.title}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="gift-given-new-title">…or a new idea</label>
          <br />
          <input
            id="gift-given-new-title"
            name="newTitle"
            placeholder="Red Ryder BB Gun"
          />{" "}
          <input name="newUrl" type="url" placeholder="https://… (optional)" />
        </p>
        <fieldset>
          <legend>When (optional)</legend>
          <label>
            Year <input name="year" type="number" min="1" placeholder="1941" />
          </label>{" "}
          <label>
            Month{" "}
            <input
              name="month"
              type="number"
              min="1"
              max="12"
              placeholder="12"
            />
          </label>{" "}
          <label>
            Day{" "}
            <input name="day" type="number" min="1" max="31" placeholder="25" />
          </label>
        </fieldset>
        <p>
          <button type="submit">Save</button> <Link to={cancelTo}>Cancel</Link>
        </p>
      </fieldset>
    </Form>
  );
}
