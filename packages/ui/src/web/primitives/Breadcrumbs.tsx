import { Fragment } from "react";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";

export interface Crumb {
  label: string;
  /** Omit on the current (last) crumb so it renders as plain text. */
  href?: string;
}

/** A caller-supplied breadcrumb trail; the last crumb, the current page, is
 *  not linked. */
export function Breadcrumbs({ trail }: { trail: readonly Crumb[] }) {
  const { Link } = useUi();
  const m = useMessages();

  return (
    <nav aria-label={m.breadcrumbs.label}>
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
