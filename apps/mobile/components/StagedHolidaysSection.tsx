import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { HolidayListItem } from "@leapsake/core";
import { formatOccurrence } from "@leapsake/schema";
import { splitBearerHolidays } from "@leapsake/view-models";
import { HolidayBrowser } from "./HolidayBrowser";
import { rowMenuItem } from "./RowMenu";
import { SummaryRow } from "./SummaryRow";
import { RecordSection } from "./RecordSection";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/** A staged holiday: what the catalog and a bearer's candidates agree on. */
export interface StagedHoliday {
  id: string;
  name: string;
  nextOccurrence: string | null;
  hidden: boolean;
}

/**
 * Holidays staged on a form, from the plain catalog, since there is no bearer
 * yet. It includes hidden holidays, so `splitBearerHolidays` drops them.
 */
export function StagedHolidaysSection({
  entries,
  onChange,
}: {
  entries: StagedHoliday[];
  onChange: (entries: StagedHoliday[]) => void;
}) {
  const core = useCore();
  const [catalog, setCatalog] = useState<HolidayListItem[] | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    void core.holidays.list().then((items) => {
      if (active) setCatalog(items);
    });
    return () => {
      active = false;
    };
  }, [core]);

  const staged = new Set(entries.map((h) => h.id));
  const { addable } = splitBearerHolidays(
    (catalog ?? []).map((h) => ({ ...h, observes: staged.has(h.id) })),
  );

  return (
    <RecordSection
      title="Holidays"
      link={
        adding
          ? undefined
          : { what: "holiday", action: "add", onPress: () => setAdding(true) }
      }
      isEmpty={entries.length === 0 && !adding}
      emptyText="No holidays yet."
    >
      {adding && (
        <View style={styles.inlineForm}>
          {catalog === null ? (
            <Text style={styles.muted}>Loading holidays…</Text>
          ) : (
            <HolidayBrowser
              addable={addable}
              onAdd={(holiday) => onChange([...entries, holiday])}
            />
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => setAdding(false)}
          >
            <Text style={styles.link}>Done</Text>
          </Pressable>
        </View>
      )}

      {entries.map((holiday) => (
        <SummaryRow
          key={holiday.id}
          title={holiday.name}
          detail={
            holiday.nextOccurrence === null
              ? "—"
              : formatOccurrence(holiday.nextOccurrence)
          }
          menu={{
            subject: holiday.name,
            items: [
              rowMenuItem.remove(() =>
                onChange(entries.filter((h) => h.id !== holiday.id)),
              ),
            ],
          }}
        />
      ))}
    </RecordSection>
  );
}
