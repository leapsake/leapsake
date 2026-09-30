import { Alert, Text } from "react-native";
import { useRouter } from "expo-router";
import type { BearerHolidayCandidate } from "@leapsake/core";
import type { ObservanceBearerType } from "@leapsake/schema";
import { formatOccurrence } from "@leapsake/schema";
import { entityBasePath } from "@leapsake/ui/headless";
import { splitBearerHolidays } from "@leapsake/view-models";
import { rowMenuItem } from "./RowMenu";
import { RecordSection } from "./RecordSection";
import { SummaryRow } from "./SummaryRow";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * The holidays someone observes, each written at once with no Save, and
 * linking to that observance's own reminder schedule.
 */
export function HolidaysSection({
  bearerType,
  bearerId,
  holidays,
  onChanged,
}: {
  bearerType: ObservanceBearerType;
  bearerId: string;
  holidays: BearerHolidayCandidate[];
  /** Refetch the page — clearing an observance writes where it stands. */
  onChanged: () => void;
}) {
  const core = useCore();
  const router = useRouter();
  // Only what this bearer keeps; what is addable is the picker's business.
  const { observed } = splitBearerHolidays(holidays);

  function confirmRemove(holiday: BearerHolidayCandidate) {
    Alert.alert("Remove holiday", `Remove ${holiday.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          core.holidays
            .setObservers(holiday.id, [
              { bearerType, bearerId, observes: false },
            ])
            .then(
              () => onChanged(),
              (e: unknown) => Alert.alert("Couldn't remove", String(e)),
            );
        },
      },
    ]);
  }

  return (
    <RecordSection
      title="Holidays"
      link={{
        href: `${entityBasePath(bearerType)}/${bearerId}/holidays/new`,
        what: "holiday",
        action: "add",
      }}
      isEmpty={observed.length === 0}
      emptyText="No holidays yet."
    >
      {observed.map((holiday) => (
        <SummaryRow
          key={holiday.id}
          title={
            <Text style={styles.rowText}>
              {holiday.name}
              {holiday.hidden ? " (hidden)" : ""}
            </Text>
          }
          detail={
            holiday.nextOccurrence === null
              ? "—"
              : formatOccurrence(holiday.nextOccurrence)
          }
          menu={{
            subject: holiday.name,
            items: [
              rowMenuItem.reminders(() =>
                router.push(
                  `/holidays/${holiday.id}/observers/${bearerType}/${bearerId}`,
                ),
              ),
              rowMenuItem.remove(() => confirmRemove(holiday)),
            ],
          }}
        />
      ))}
    </RecordSection>
  );
}
