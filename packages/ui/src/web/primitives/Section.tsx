import type { ReactNode } from "react";

/**
 * A titled section of a detail screen — the shell every “Tags”, “Milestones”,
 * “Relationships”, “Contact” and “Holidays” block on a person or pet page shares:
 * a heading, optional actions beside it, and the content below.
 *
 * The heading is an `<h2>` because these sit under a screen's single `<h1>`.
 */
export function Section({
  title,
  actions,
  children,
}: {
  title: string;
  /** Links or buttons that act on the section as a whole, e.g. “Add milestone”. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <header>
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

/**
 * What a section (or screen) shows instead of a list when there is nothing in it
 * yet. Deliberately a plain paragraph: an empty list is a normal state, not a
 * problem to be announced.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}
