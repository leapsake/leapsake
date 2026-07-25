import { render } from "@testing-library/react";
import type { ReactElement } from "react";
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
  Form: ({ method, action, children }) => (
    <form method={method} action={action}>
      {children}
    </form>
  ),
};

/** Render a component with the adapter its `useUi()` calls expect. */
export function renderWithUi(ui: ReactElement) {
  return render(<UiProvider adapter={testAdapter}>{ui}</UiProvider>);
}
