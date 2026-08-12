import type { UiAdapter } from "@leapsake/ui/web";

/**
 * The whole of what an SSR web client owes `@leapsake/ui`.
 *
 * **That this is six lines is the finding.** The package's navigation and form
 * contract is written in HTML's own vocabulary — `href` on the link, `method` and
 * `action` on the form — so the no-JS host is the *degenerate* adapter: every
 * prop passes through to the element it was named after. Desktop's adapter
 * (`apps/desktop/src/renderer/src/lib/ui-adapter.tsx`) does strictly more work,
 * mapping `href` → react-router's `to`.
 *
 * That is not an accident of this spike. `UiFormProps` says the adapter *must*
 * render a real `<form>` with `method`/`action` intact, "exactly the case where
 * no adapter JavaScript runs and the browser posts the form itself". This file is
 * that sentence executed: the floor the package promised is reachable without
 * touching the package.
 */
export const ssrUiAdapter: UiAdapter = {
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
