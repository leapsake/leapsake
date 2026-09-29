import type { FormEvent, ReactNode } from "react";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import styles from "./not-ready.module.css";
import { readyToSubmit } from "./form-problem.js";

/** The frame every create/edit form shares: a posting `<form>` to its route,
 *  and Save/Cancel in a header with a `title`, else at the foot. */
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
  /** Why the form isn't ready; Save stays pressable and says this. */
  problem?: string;
  /** Hidden inputs outside the fieldset, so disabling it never drops them. */
  beforeFields?: ReactNode;
  children: ReactNode;
}) {
  const { Form, Link } = useUi();
  const m = useMessages();

  const cancel = <Link href={cancelTo}>{m.common.cancel}</Link>;
  const saveClass = problem === undefined ? undefined : styles.notReady;

  function holdOrRefuse(event: FormEvent<HTMLFormElement>) {
    if (!readyToSubmit(submitting, problem)) event.preventDefault();
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
