import { Fragment, type ReactNode } from "react";

export interface Detail {
  term: string;
  /** Render a dash for “not set” rather than leaving the value blank. */
  value: ReactNode;
}

/** A view screen's label/value list as a real `<dl>`, keyed by position
 *  because terms can repeat. */
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
