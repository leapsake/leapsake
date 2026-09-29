/** Tells the user why the form cannot be saved yet, in a native dialog. */
export function showFormProblem(message: string): void {
  window.alert(message);
}

/** Whether a press may submit: not while writing, nor while `problem` is set,
 *  which it shows. */
export function readyToSubmit(
  submitting: boolean,
  problem: string | undefined,
): boolean {
  if (submitting) return false;
  if (problem === undefined) return true;
  showFormProblem(problem);
  return false;
}
