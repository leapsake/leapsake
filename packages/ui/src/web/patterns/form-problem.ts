/** Tells the user why the form cannot be saved yet. The one place to swap in our own modal. */
export function showFormProblem(message: string): void {
  window.alert(message);
}

/** Whether a press may submit: never while a write is in flight, and not while `problem` is set, which it shows. */
export function readyToSubmit(
  submitting: boolean,
  problem: string | undefined,
): boolean {
  if (submitting) return false;
  if (problem === undefined) return true;
  showFormProblem(problem);
  return false;
}
