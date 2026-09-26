import type { FormEvent } from "react";

/** An `onSubmit` that ignores a second submission while the first is in flight. */
export function holdWhileSubmitting(submitting: boolean) {
  return (event: FormEvent<HTMLFormElement>) => {
    if (submitting) event.preventDefault();
  };
}
