import { useCallback, useState } from "react";

/** What a form's shaping function returns: the value to save, or error codes by field. */
export type Shaped<Ok, Errors> =
  | ({ ok: true } & Ok)
  | { ok: false; errors: Errors };

/**
 * A form's draft, and what its shaping function makes of it on every render. `submit()`
 * returns the shaped value, or null while the draft is invalid.
 */
export function useDraftForm<Draft extends object, Ok, Errors extends object>(
  initial: () => Draft,
  shape: (draft: Draft) => Shaped<Ok, Errors>,
) {
  const [fields, setFields] = useState(initial);
  const set = useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K]) =>
      setFields((draft) => ({ ...draft, [key]: value })),
    [],
  );
  const update = useCallback(
    (edit: (draft: Draft) => Draft) => setFields(edit),
    [],
  );
  const shaped = shape(fields);
  const errors: Partial<Errors> = shaped.ok ? {} : shaped.errors;
  return {
    fields,
    set,
    update,
    reset: () => setFields(initial()),
    errors,
    canSubmit: shaped.ok,
    submit: () => (shaped.ok ? shaped : null),
  };
}
