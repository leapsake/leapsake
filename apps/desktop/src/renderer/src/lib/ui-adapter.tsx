import type { UiAdapter } from "@leapsake/ui/web";
import { Form, Link } from "react-router-dom";

/**
 * The `@leapsake/ui` adapter. `Form` passes straight through: react-router's
 * already renders a real `<form>` with `method` and `action`.
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
