import type { ReactNode } from "react";
import styles from "./Combobox.module.css";

/**
 * The ARIA wiring a combobox's field must carry. Handed to {@link Combobox}'s
 * `renderField` so the caller can own the element — the three call sites this
 * replaced render a search input, a filter input, and a `<textarea>` — while the
 * package keeps the ids and relationships correct.
 */
export interface ComboboxFieldAria {
  role: "combobox";
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-activedescendant": string | undefined;
  "aria-autocomplete": "list";
}

/**
 * The suggestion listbox of a WAI-ARIA combobox: the overlay, the option rows,
 * and the live region — everything except the field itself and the keyboard
 * handling, which is {@link useTypeahead}'s job.
 *
 * The listbox is positioned as an overlay so content below the field doesn't
 * jump while typing, and options commit on `mousedown` rather than `click`:
 * `click` fires after the field blurs, by which point the listbox is gone.
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
  /**
   * Text for the polite live region. Omit for a field where the visible result
   * is announcement enough; supply it where the outcome happens elsewhere in
   * the DOM — adding to a list the field sits above, for instance.
   */
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

/**
 * A secondary line inside an option — why a result matched, say. Exists so the
 * class name stays inside the package rather than being exported as a string
 * for callers to apply.
 */
export function ComboboxOptionDetail({ children }: { children: ReactNode }) {
  return <span className={styles.detail}>{children}</span>;
}
