/** Tells the user why the form cannot be saved yet. The one place to swap in our own modal. */
export function showFormProblem(message: string): void {
  window.alert(message);
}
