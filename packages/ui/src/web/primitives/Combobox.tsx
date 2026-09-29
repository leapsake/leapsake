import type { ReactNode } from "react";
import styles from "./Combobox.module.css";

/** The ARIA wiring a combobox's field must carry, for a caller-owned field. */
export interface ComboboxFieldAria {
  role: "combobox";
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-activedescendant": string | undefined;
  "aria-autocomplete": "list";
}

/**
 * The suggestion listbox of a WAI-ARIA combobox. Options commit on `mousedown`,
 * since `click` fires after the blur that removes the listbox.
 */
export function Combobox<T>({
  results,
  activeIndex,
  listboxId,
  optionId,
  getKey,
  onSelect,
  renderOption,
  announcement,
  renderField,
  containerTag: Container = "div",
}: {
  results: readonly T[];
  activeIndex: number;
  /** From {@link useTypeahead}, which owns the ids. */
  listboxId: string;
  optionId: (index: number) => string;
  getKey: (option: T) => string;
  onSelect: (option: T) => void;
  renderOption: (option: T) => ReactNode;
  /** Text for the polite live region, where the result lands elsewhere. */
  announcement?: string;
  renderField: (aria: ComboboxFieldAria) => ReactNode;
  /** `span` for a combobox that sits inline inside a `<label>`. */
  containerTag?: "div" | "span";
}) {
  const open = results.length > 0;

  return (
    <Container className={styles.container}>
      {renderField({
        role: "combobox",
        "aria-expanded": open,
        "aria-controls": listboxId,
        "aria-activedescendant": open ? optionId(activeIndex) : undefined,
        "aria-autocomplete": "list",
      })}
      {open && (
        <ul className={styles.listbox} role="listbox" id={listboxId}>
          {results.map((option, index) => (
            <li
              key={getKey(option)}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={styles.option}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(option);
              }}
            >
              {renderOption(option)}
            </li>
          ))}
        </ul>
      )}
      {announcement !== undefined && (
        <span className={styles.visuallyHidden} aria-live="polite">
          {announcement}
        </span>
      )}
    </Container>
  );
}

/** A secondary line inside an option, such as why a result matched. */
export function ComboboxOptionDetail({ children }: { children: ReactNode }) {
  return <span className={styles.detail}>{children}</span>;
}
