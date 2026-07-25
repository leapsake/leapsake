import { Fragment, type ReactNode } from "react";

export interface Detail {
  term: string;
  /** Render a dash for “not set” rather than leaving the value blank. */
  value: ReactNode;
}

/**
 * The label/value list on a view screen — a real `<dl>`, so each value stays
 * associated with its term for assistive tech rather than being two adjacent
 * runs of text that happen to look aligned.
 *
 * Pairs are emitted flat rather than wrapped in the `<div>` grouping HTML5
 * allows: that wrapper exists to give CSS something to lay out, and styling is a
 * later pass. Adding it now would change markup for no present benefit.
 *
 * Keyed by position, not by term: a detail list is a fixed, ordered list, and
 * terms legitimately repeat — a relationship between two siblings shows “Sibling”
 * twice.
 */
export function DetailList({ details }: { details: readonly Detail[] }) {
  return (
    <dl>
      {details.map((detail, index) => (
        <Fragment key={index}>
          <dt>{detail.term}</dt>
          <dd>{detail.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
