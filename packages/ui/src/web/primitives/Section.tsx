import type { ReactNode } from "react";

/** A titled section of a detail screen, under its `<h1>`. */
export function Section({
  title,
  actions,
  children,
}: {
  title: string;
  /** Actions on the section as a whole, such as “Add milestone”. */
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

/** What shows in place of an empty list: a plain paragraph, not an alert. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}
