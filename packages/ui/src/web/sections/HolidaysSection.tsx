import { type ObservanceBearerType, formatOccurrence } from "@leapsake/schema";
import { useSerializedWrites } from "../../headless/useSerializedWrites.js";
import { useUi } from "../adapter.js";
import { DataTable } from "../primitives/DataTable.js";
import { MultiAddCombobox } from "../primitives/MultiAddCombobox.js";
import { EmptyState, Section } from "../primitives/Section.js";

/** A holiday offered to, or already observed by, this bearer. */
export interface BearerHoliday {
  id: string;
  name: string;
  observes: boolean;
  hidden: boolean;
  nextOccurrence: string | null;
}

/**
 * The Holidays section on a Person or Pet screen — the mirror of the “Observed
 * by” field on a holiday. Adding an observance from either direction writes the
 * same row, so which surface a user reaches for is purely a matter of what they
 * happen to be looking at.
 *
 * Each row links to that observance's reminder schedule rather than editing
 * anything here, because the reminder rule bears on the *observance*: two people
 * who observe the same holiday can be reminded about entirely different things.
 *
 * Writes are serialised (see {@link useSerializedWrites}): a submission started
 * mid-flight would supersede the previous one and silently drop a pick during a
 * rapid type→Enter→type→Enter.
 */
export function HolidaysSection({
  bearerType,
  bearerId,
  holidays,
  onSetObserves,
  onChanged,
}: {
  bearerType: ObservanceBearerType;
  bearerId: string;
  holidays: readonly BearerHoliday[];
  /** Record (or clear) this bearer's observance of a holiday. */
  onSetObserves: (holidayId: string, observes: boolean) => Promise<unknown>;
  /** Called after each write lands, to re-read the data behind this section. */
  onChanged: () => void;
}) {
  const { Link } = useUi();
  const { busy, error, run } = useSerializedWrites({ onSuccess: onChanged });

  const observed = holidays.filter((h) => h.observes);
  // Hidden holidays are excluded from *suggestions* because offering one would
  // be offering a no-op — a hidden holiday generates no reminders, so adding an
  // observance to it would appear to do nothing. The browse list deliberately
  // differs: that is where a user goes to unhide one, so filtering them out
  // there would strand them. A hidden holiday already observed still shows in
  // the list below, marked, or the state would be unexplainable.
  const addable = holidays.filter((h) => !h.observes && !h.hidden);

  return (
    <Section title="Holidays">
      {error !== null && <p>Couldn't save: {error}</p>}

      <MultiAddCombobox
        label={`Add a holiday this ${bearerType} observes`}
        placeholder="Add a holiday…"
        options={addable}
        getKey={(h) => h.id}
        getLabel={(h) => h.name}
        onPick={(h) => run(() => onSetObserves(h.id, true))}
      />

      {observed.length === 0 ? (
        <EmptyState>No holidays yet.</EmptyState>
      ) : (
        <DataTable
          items={observed}
          getKey={(holiday) => holiday.id}
          columns={[
            {
              header: "Holiday",
              cell: (holiday) => (
                <>
                  {holiday.name}
                  {holiday.hidden && " (hidden)"}
                </>
              ),
            },
            {
              header: "Next",
              cell: (holiday) =>
                holiday.nextOccurrence === null
                  ? "—"
                  : formatOccurrence(holiday.nextOccurrence),
            },
            {
              header: "",
              cell: (holiday) => (
                <>
                  <Link
                    href={`/holidays/${holiday.id}/observers/${bearerType}/${bearerId}`}
                  >
                    Reminders
                  </Link>{" "}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => onSetObserves(holiday.id, false))}
                  >
                    Remove
                  </button>
                </>
              ),
            },
          ]}
        />
      )}
    </Section>
  );
}
