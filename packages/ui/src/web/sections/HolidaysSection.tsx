import { type ObservanceBearerType, formatOccurrence } from "@leapsake/schema";
import { splitBearerHolidays } from "@leapsake/view-models";
import { useSerializedWrites } from "../../headless/useSerializedWrites.js";
import { useMessages } from "../../messages/index.js";
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
 * A person's or pet's holidays, the mirror of a holiday's “Observed by”. Each
 * row links to its observance's own reminder schedule.
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
  const m = useMessages();
  const { busy, error, run } = useSerializedWrites({ onSuccess: onChanged });

  // Hidden holidays are never offered; see {@link splitBearerHolidays}.
  const { observed, addable } = splitBearerHolidays(holidays);

  return (
    <Section title={m.holidays.title}>
      {error !== null && <p>{m.common.saveFailed(error)}</p>}

      <MultiAddCombobox
        label={m.holidays.addLabel(bearerType)}
        placeholder={m.holidays.addPlaceholder}
        options={addable}
        getKey={(h) => h.id}
        getLabel={(h) => h.name}
        onPick={(h) => run(() => onSetObserves(h.id, true))}
        announceAdded={m.combobox.added}
        announceCount={m.combobox.suggestionCount}
      />

      {observed.length === 0 ? (
        <EmptyState>{m.holidays.empty}</EmptyState>
      ) : (
        <DataTable
          items={observed}
          getKey={(holiday) => holiday.id}
          columns={[
            {
              header: m.holidays.columnHoliday,
              cell: (holiday) =>
                holiday.hidden
                  ? m.holidays.hiddenName(holiday.name)
                  : holiday.name,
            },
            {
              header: m.holidays.columnNext,
              cell: (holiday) =>
                holiday.nextOccurrence === null
                  ? m.common.none
                  : formatOccurrence(holiday.nextOccurrence),
            },
            {
              header: "",
              cell: (holiday) => (
                <>
                  <Link
                    href={`/holidays/${holiday.id}/observers/${bearerType}/${bearerId}`}
                  >
                    {m.holidays.reminders}
                  </Link>{" "}
                  <button
                    type="button"
                    aria-disabled={busy}
                    onClick={() => {
                      if (!busy) run(() => onSetObserves(holiday.id, false));
                    }}
                  >
                    {m.common.remove}
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
