import type { FormEvent } from "react";

/** An `onSubmit` that ignores a second submission while one is in flight. */
export function holdWhileSubmitting(submitting: boolean) {
  return (event: FormEvent<HTMLFormElement>) => {
    if (submitting) event.preventDefault();
  };
}
