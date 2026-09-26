import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { onTestFinished } from "vitest";
import { MessagesProvider, en } from "../src/messages/index.js";
import { UiProvider, type UiAdapter } from "../src/web/index.js";

/**
 * A host adapter built from plain DOM elements — no router, no framework. It is
 * what the package's contract actually requires, so testing against it proves a
 * component works for *any* conforming client rather than for react-router
 * specifically.
 */
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

/**
 * Render a component with the two things every package component may reach for:
 * the host adapter and the message catalog. Tests assert against `en`, so a
 * changed string shows up as a failing test rather than silently passing.
 */
export function renderWithUi(ui: ReactElement) {
  return render(
    <MessagesProvider messages={en}>
      <UiProvider adapter={testAdapter}>{ui}</UiProvider>
    </MessagesProvider>,
  );
}

/**
 * Records, per submit, whether the form stopped it. Listens below the React root,
 * so it sees the form's own handling; then stops the post itself, as jsdom can't.
 */
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
