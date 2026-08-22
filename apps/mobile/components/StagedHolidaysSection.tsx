import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { HolidayListItem } from "@leapsake/core";
import { formatOccurrence } from "@leapsake/schema";
import { splitBearerHolidays } from "@leapsake/view-models";
import { HolidayBrowser } from "./HolidayBrowser";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * A holiday as a staged row: what both sources of one agree on. The create
 * screen picks from the catalog (`HolidayListItem`) and the edit screen seeds
 * from what a bearer already observes (`BearerHolidayCandidate`), and the two
 * differ in ways — an observer count, a stored answer — that a row neither shows
 * nor writes.
 */
export interface StagedHoliday {
  id: string;
  name: string;
  nextOccurrence: string | null;
  hidden: boolean;
}

/**
 * Holidays on the **create** and **edit** screens — the staged counterpart to
 * {@link HolidaysSection}, whose picks become `core.holidays.setObservers` calls
 * when the form is saved. See {@link StagedMilestonesSection} for why staging
 * works this way.
 *
 * Unlike the detail section this reads `core.holidays.list()`, the plain catalog:
 * on the create screen `listForBearer` needs a bearer that doesn't exist yet, and
 * on the edit screen what the bearer already observes is staged in `entries`
 * rather than re-read. That list deliberately *includes* hidden holidays (the
 * browse screen is where a user unhides one), so the picks are run back through
 * `splitBearerHolidays` to apply the same rule the detail section got for free:
 * never offer a hidden holiday, since observing one would be a no-op.
 *
 * Browsing the catalog is {@link HolidayBrowser}, shared with the "Add holiday"
 * screen a saved record's page pushes to — one list, so the create and edit
 * paths cannot drift. What this supplies is the list of what is still addable:
 * the whole catalog minus what is already staged here.
 *
 * Per-observance reminder schedules aren't offered here. They belong to the
 * observance rather than the holiday, and the row that edits them lives on the
 * detail page, where the observance is real.
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
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Holidays</Text>
        {!adding && (
          <Pressable accessibilityRole="button" onPress={() => setAdding(true)}>
            <Text style={styles.link}>Add holiday</Text>
          </Pressable>
        )}
      </View>

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

      {entries.length === 0
        ? !adding && <Text style={styles.muted}>No holidays yet.</Text>
        : entries.map((holiday) => (
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
                  accessibilityLabel={`Remove ${holiday.name}`}
                  onPress={() =>
                    onChange(entries.filter((h) => h.id !== holiday.id))
                  }
                >
                  <Text style={[styles.link, styles.danger]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}
    </View>
  );
}
