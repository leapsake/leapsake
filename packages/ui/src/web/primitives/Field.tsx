import type { ReactNode } from "react";

/**
 * A labelled control, on one line: “Name [input]”.
 *
 * The control is rendered *inside* the `<label>`, which associates the two
 * without an id on either — one less thing to keep unique, and the association
 * can't drift the way a `htmlFor`/`id` pair can.
 */
export function Field({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <label>
      {label} {children}
    </label>
  );
}

/**
 * A labelled control with the label on its own line above it — for longer inputs
 * (a URL, a note, a mention-aware text field) where an inline label crowds them.
 *
 * Same implicit association as {@link Field}.
 */
export function StackedField({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <p>
      <label>
        {label}
        <br />
        {children}
      </label>
    </p>
  );
}
