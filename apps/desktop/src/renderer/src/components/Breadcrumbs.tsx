import { Fragment } from "react";
import { Link } from "react-router-dom";

export interface Crumb {
  label: string;
  /** Omit on the current (last) crumb so it renders as plain text. */
  to?: string;
}

/** The shared root crumb: the combined People & Pets list at `/people`. */
export const homeCrumb: Crumb = { label: "People & Pets", to: "/people" };

/** A breadcrumb trail; the final crumb is the current page and is not linked. */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      {trail.map((crumb, index) => (
        <Fragment key={crumb.to ?? crumb.label}>
          {index > 0 && " / "}
          {crumb.to ? (
            <Link to={crumb.to}>{crumb.label}</Link>
          ) : (
            <span>{crumb.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
