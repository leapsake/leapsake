import { Fragment } from "react";
import { useUi } from "../adapter.js";

export interface Crumb {
  label: string;
  /** Omit on the current (last) crumb so it renders as plain text. */
  href?: string;
}

/**
 * A breadcrumb trail; the final crumb is the current page and is not linked.
 *
 * The trail is entirely caller-supplied — the package deliberately ships no
 * “home” crumb, because which route is home is an application decision (on
 * desktop it is People & Pets at `/people`; a client with different top-level
 * navigation would answer differently).
 */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  const { Link } = useUi();

  return (
    <nav aria-label="Breadcrumb">
      {trail.map((crumb, index) => (
        <Fragment key={crumb.href ?? crumb.label}>
          {index > 0 && " / "}
          {crumb.href ? (
            <Link href={crumb.href}>{crumb.label}</Link>
          ) : (
            <span>{crumb.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
