import type { ReactNode } from "react";
import { Form, Link } from "react-router-dom";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";

/**
 * The confirm-before-destroying screen, shared by every delete/remove route.
 *
 * All ten of them were the same page — breadcrumbs, a question as the heading,
 * a sentence of prose naming what's about to go, and a `<Form method="post">`
 * whose `<fieldset>` disables while the submission is in flight — differing only
 * in wording and where Cancel returns to. The route action is addressed by the
 * route itself, so the form needs no `action`.
 *
 * The `<fieldset disabled>` is the load-bearing part: it takes the submit button
 * out of play for the moment between click and navigation, so an impatient
 * double-click can't post the destructive action twice.
 */
export function ConfirmDelete({
  trail,
  heading,
  confirmLabel,
  cancelTo,
  submitting,
  hiddenFields,
  children,
}: {
  trail: Crumb[];
  /** The question, e.g. “Delete Ada Lovelace?”. */
  heading: ReactNode;
  /** The destructive button's text — “Delete” or “Remove”. */
  confirmLabel: string;
  /** Where Cancel returns to; normally the page the user came from. */
  cancelTo: string;
  submitting: boolean;
  /**
   * Extra values the action needs, posted as hidden inputs. Used by the
   * inferred-relationship dismiss, whose edge has no stored id and must carry
   * its identity (other endpoint + base role) in the submission. They sit
   * *outside* the `<fieldset>` so disabling it can never drop them.
   */
  hiddenFields?: Record<string, string>;
  /** The prose explaining what is about to happen. */
  children: ReactNode;
}) {
  return (
    <main>
      <Breadcrumbs trail={trail} />
      <h1>{heading}</h1>
      <p>{children}</p>

      <Form method="post">
        {hiddenFields &&
          Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
        <fieldset disabled={submitting}>
          <button type="submit">{confirmLabel}</button>{" "}
          <Link to={cancelTo}>Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
