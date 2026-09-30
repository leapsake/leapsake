import type { ReactNode } from "react";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import { holdWhileSubmitting } from "./hold-while-submitting.js";
import { Breadcrumbs, type Crumb } from "../primitives/Breadcrumbs.js";

/**
 * The confirm-before-destroying screen every delete route shares. A second
 * press while posting is ignored; nothing is disabled.
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
  /** The question, e.g. “Delete Mary Bailey?”. */
  heading: ReactNode;
  /** The destructive button's text — “Delete” or “Remove”. */
  confirmLabel: string;
  /** Where Cancel returns to; normally the page the user came from. */
  cancelTo: string;
  submitting: boolean;
  /** Extra values posted as hidden inputs, like a derived edge's identity. */
  hiddenFields?: Record<string, string>;
  /** The prose explaining what is about to happen. */
  children: ReactNode;
}) {
  const { Form, Link } = useUi();
  const m = useMessages();

  return (
    <main>
      <Breadcrumbs trail={trail} />
      <h1>{heading}</h1>
      <p>{children}</p>

      <Form method="post" onSubmit={holdWhileSubmitting(submitting)}>
        {hiddenFields &&
          Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
        <fieldset>
          <button type="submit" aria-disabled={submitting}>
            {confirmLabel}
          </button>{" "}
          <Link href={cancelTo}>{m.common.cancel}</Link>
        </fieldset>
      </Form>
    </main>
  );
}
