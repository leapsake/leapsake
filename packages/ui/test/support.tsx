import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { onTestFinished } from "vitest";
import { MessagesProvider, en } from "../src/messages/index.js";
import { UiProvider, type UiAdapter } from "../src/web/index.js";

/** A host adapter of plain DOM elements: the contract, and no router. */
export const testAdapter: UiAdapter = {
  Link: ({ href, children, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  Form: ({ method, action, onSubmit, children }) => (
    <form method={method} action={action} onSubmit={onSubmit}>
      {children}
    </form>
  ),
};

/** Renders with the host adapter and the `en` catalog. */
export function renderWithUi(ui: ReactElement) {
  return render(
    <MessagesProvider messages={en}>
      <UiProvider adapter={testAdapter}>{ui}</UiProvider>
    </MessagesProvider>,
  );
}

/** Records, per submit, whether the form stopped it, then stops the post
 *  itself, as jsdom can't. */
export function recordSubmits(): () => boolean[] {
  const stopped: boolean[] = [];
  const record = (event: Event) => {
    stopped.push(event.defaultPrevented);
    event.preventDefault();
  };
  document.addEventListener("submit", record);
  onTestFinished(() => document.removeEventListener("submit", record));
  return () => stopped;
}
