import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { HolidayListItem } from "@leapsake/core";
import { formatOccurrence } from "@leapsake/schema";
import { splitBearerHolidays } from "@leapsake/view-models";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";
import { Typeahead } from "./Typeahead";

/**
 * Holidays on the **create** screen — the staged counterpart to
 * {@link HolidaysSection}, whose picks become `core.holidays.setObservers` calls
 * once the bearer has an id. See {@link StagedMilestonesSection} for why staging
 * works this way.
 *
 * Unlike the detail section this reads `core.holidays.list()`, the plain catalog,
 * because `listForBearer` needs a bearer that doesn't exist yet. That list
 * deliberately *includes* hidden holidays (the browse screen is where a user
 * unhides one), so the picks are run back through `splitBearerHolidays` to apply
 * the same rule the detail section gets for free: never offer a hidden holiday,
 * since observing one would be a no-op.
 *
 * Per-observance reminder schedules aren't offered here. They belong to the
 * observance rather than the holiday, and the row that edits them lives on the
 * detail page once the observance is real.
 */
export function StagedHolidaysSection({
  entries,
  onChange,
}: {
  entries: HolidayListItem[];
  onChange: (entries: HolidayListItem[]) => void;
}) {
  const core = useCore();
  const [catalog, setCatalog] = useState<HolidayListItem[] | null>(null);

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
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Holidays</Text>
      </View>

      <Typeahead
        multi
        label="Add a holiday"
        value={null}
        options={addable}
        onChange={(h) => h !== null && onChange([...entries, h])}
        getKey={(h) => h.id}
        getLabel={(h) => h.name}
        placeholder={
          catalog === null ? "Loading holidays…" : "Search holidays…"
        }
      />

      {entries.length === 0 ? (
        <Text style={styles.muted}>No holidays yet.</Text>
      ) : (
        entries.map((holiday) => (
          <View key={holiday.id} style={styles.row}>
            <Text style={styles.rowText}>{holiday.name}</Text>
            <View style={styles.rowMeta}>
              <Text style={styles.muted}>
                {holiday.nextOccurrence === null
                  ? "—"
                  : formatOccurrence(holiday.nextOccurrence)}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  onChange(entries.filter((h) => h.id !== holiday.id))
                }
              >
                <Text style={[styles.link, styles.danger]}>Remove</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </View>
  );
}
