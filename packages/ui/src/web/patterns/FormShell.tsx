import type { FormEvent, ReactNode } from "react";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import styles from "./not-ready.module.css";
import { showFormProblem } from "./form-problem.js";

/**
 * The frame every create/edit form shares: a posting `<form>`, a `<fieldset>`
 * that disables while the submission is in flight, and a Save/Cancel pair.
 *
 * Two layouts, chosen by whether a `title` is given, because the forms genuinely
 * differ in what owns the page:
 *
 * - **With a title** the form *is* the screen, so the title and its actions sit
 *   in a header above the fields. The submit button is outside the `<fieldset>`
 *   and disables itself, which is what lets it stay legible while the fields grey
 *   out.
 * - **Without one** the form is embedded under a screen that already has its own
 *   `<h1>`, so the actions sit at the foot, inside the fieldset.
 *
 * The action is the route the form is on, so there is no `action` attribute —
 * and the fields keep their own `name`s, which is what the write path reads.
 */
export function FormShell({
  title,
  submitLabel,
  cancelTo,
  submitting,
  canSubmit = true,
  problem,
  beforeFields,
  children,
}: {
  /** Present when this form is the whole screen. */
  title?: ReactNode;
  submitLabel: string;
  cancelTo: string;
  submitting: boolean;
  /** False while the form's own rules say it isn't ready to send. Disables Save. */
  canSubmit?: boolean;
  /**
   * Why the form isn't ready, if it isn't. Save stays pressable and says this when
   * pressed; replaces `canSubmit` as each form moves to its hook.
   */
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
  const blocked = problem === undefined && !canSubmit;
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
            disabled={blocked}
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
              disabled={blocked}
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
