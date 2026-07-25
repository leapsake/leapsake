import type { UiAdapter } from "@leapsake/ui/web";
import { Form, Link } from "react-router-dom";

/**
 * Desktop's implementation of the `@leapsake/ui` adapter — the whole of what a
 * client owes the shared UI package.
 *
 * `Link` maps the package's HTML-shaped `href` onto react-router's `to`; `Form`
 * passes straight through, because react-router's `<Form>` already renders a real
 * `<form>` with `method`/`action` intact (the property the no-JS floor depends
 * on, even though Electron always has JavaScript).
 */
export const desktopUiAdapter: UiAdapter = {
  Link: ({ href, children, ...rest }) => (
    <Link to={href} {...rest}>
      {children}
    </Link>
  ),
  Form: ({ method, action, children }) => (
    <Form method={method} action={action}>
      {children}
    </Form>
  ),
};
