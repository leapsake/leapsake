import type { FormEvent, ReactNode } from "react";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import styles from "./not-ready.module.css";
import { showFormProblem } from "./form-problem.js";

/**
 * The frame every create/edit form shares: a posting `<form>` to its own route,
 * and a Save/Cancel pair, in a header when there is a `title` and at the foot when not.
 */
export function FormShell({
  title,
  submitLabel,
  cancelTo,
  submitting,
  problem,
  beforeFields,
  children,
}: {
  /** Present when this form is the whole screen. */
  title?: ReactNode;
  submitLabel: string;
  cancelTo: string;
  submitting: boolean;
  /** Why the form isn't ready, if it isn't. Save stays pressable and says this when pressed. */
  problem?: string;
  /**
   * Content between the form and its fieldset — in practice, hidden inputs
   * carrying values resolved from what the user typed. They sit outside the
   * fieldset so disabling it can never drop them.
   */
  beforeFields?: ReactNode;
  children: ReactNode;
}) {
  const { Form, Link } = useUi();
  const m = useMessages();

  const cancel = <Link href={cancelTo}>{m.common.cancel}</Link>;
  const saveClass = problem === undefined ? undefined : styles.notReady;

  function holdOrRefuse(event: FormEvent<HTMLFormElement>) {
    if (submitting) return event.preventDefault();
    if (problem === undefined) return;
    event.preventDefault();
    showFormProblem(problem);
  }

  return (
    <Form method="post" onSubmit={holdOrRefuse}>
      {title !== undefined && (
        <header>
          <h1>{title}</h1>
          <button
            type="submit"
            className={saveClass}
            aria-disabled={submitting}
          >
            {submitLabel}
          </button>{" "}
          {cancel}
        </header>
      )}
      {beforeFields}
      <fieldset>
        {children}
        {title === undefined && (
          <p>
            <button
              type="submit"
              className={saveClass}
              aria-disabled={submitting}
            >
              {submitLabel}
            </button>{" "}
            {cancel}
          </p>
        )}
      </fieldset>
    </Form>
  );
}
