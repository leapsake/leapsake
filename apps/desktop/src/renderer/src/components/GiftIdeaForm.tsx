import type { GiftIdea } from "@leapsake/schema";
import { Form, Link, useNavigation } from "react-router-dom";

/**
 * The shared create/edit form for a GiftIdea. Title is required; URL and Notes
 * are optional (the route action drops blanks to null). Uncontrolled inputs — the
 * route action reads them straight from `FormData` — since there's no typeahead or
 * token splicing to manage (unlike the reminder form). Presentational: the route
 * action owns the write.
 */
export function GiftIdeaForm({
  idea,
  tagNames = "",
  cancelTo = "/gifts",
}: {
  idea?: GiftIdea;
  /** Comma-separated existing tag names; empty on create. */
  tagNames?: string;
  /** Where Cancel returns to — the recipient's page when launched from there. */
  cancelTo?: string;
}) {
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  return (
    <Form method="post">
      <fieldset disabled={saving}>
        <p>
          <label htmlFor="gift-idea-title">Title</label>
          <br />
          <input
            id="gift-idea-title"
            name="title"
            defaultValue={idea?.title ?? ""}
            placeholder="Red Ryder BB Gun"
            required
          />
        </p>
        <p>
          <label htmlFor="gift-idea-url">Link</label>
          <br />
          <input
            id="gift-idea-url"
            name="url"
            type="url"
            defaultValue={idea?.url ?? ""}
            placeholder="https://…"
          />
        </p>
        <p>
          <label htmlFor="gift-idea-notes">Notes</label>
          <br />
          <textarea
            id="gift-idea-notes"
            name="notes"
            rows={4}
            defaultValue={idea?.notes ?? ""}
            placeholder="the 200-shot model; she mentioned it in June"
          />
        </p>
        <p>
          <label htmlFor="gift-idea-tags">Tags</label>
          <br />
          <input
            id="gift-idea-tags"
            name="tags"
            defaultValue={tagNames}
            placeholder="#books #kitchen"
          />
        </p>
        <p>
          <button type="submit">Save</button> <Link to={cancelTo}>Cancel</Link>
        </p>
      </fieldset>
    </Form>
  );
}
