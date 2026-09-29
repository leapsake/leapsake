import type { ReactNode } from "react";

/** A labelled control on one line, inside its `<label>` so no id is needed. */
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

/** A labelled control with its label on the line above, for longer inputs. */
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
