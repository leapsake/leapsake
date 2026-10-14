import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import {
  DATE_FORMATS,
  type DateFormat,
  formatDate,
  todayCivil,
} from "@leapsake/schema";
import { useDateFormatSetting } from "../lib/date-format";
import { showFormProblem } from "../lib/form-problem";
import { colors, styles } from "../lib/styles";

const TEXT = {
  title: "Date format",
  intro:
    "How dates are written across Leapsake, on every device you use. Automatic follows your region’s usual format.",
  automatic: "Automatic",
  saveFailed: "Your date format couldn’t be saved. Please try again.",
  check: "✓",
};

/** Each format's name as the list shows it: its own placeholder. */
const LABELS: Record<DateFormat, string> = {
  "Month D, YYYY": "Month D, YYYY",
  "D Month YYYY": "D Month YYYY",
  "MM/DD/YYYY": "MM/DD/YYYY",
  "DD/MM/YYYY": "DD/MM/YYYY",
  "DD.MM.YYYY": "DD.MM.YYYY",
  "DD-MM-YYYY": "DD-MM-YYYY",
  "YYYY-MM-DD": "YYYY-MM-DD",
  "YYYY/MM/DD": "YYYY/MM/DD",
  "YYYY.MM.DD": "YYYY.MM.DD",
};

/** Settings → Date format: Automatic, then every format with today's date
 *  written in it. */
export default function DateFormatScreen() {
  const { chosen, regionDefault, choose } = useDateFormatSetting();
  const today = todayCivil();

  function pick(format: DateFormat | null) {
    choose(format).catch((cause) => {
      console.error("saving the date format failed:", cause);
      showFormProblem(TEXT.saveFailed);
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: TEXT.title }} />
      <Text style={styles.muted}>{TEXT.intro}</Text>
      <View>
        <ChoiceRow
          label={TEXT.automatic}
          example={formatDate(today, regionDefault)}
          selected={chosen === null}
          onPress={() => pick(null)}
        />
        {DATE_FORMATS.map((format) => (
          <ChoiceRow
            key={format}
            label={LABELS[format]}
            example={formatDate(today, format)}
            selected={chosen === format}
            onPress={() => pick(format)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

/** One choice: its name over an example, checked when chosen. */
function ChoiceRow({
  label,
  example,
  selected,
  onPress,
}: {
  label: string;
  example: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      accessibilityHint={example}
      style={[styles.row, styles.rowWithLead, { alignItems: "center" }]}
      onPress={onPress}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowText}>{label}</Text>
        <Text style={styles.muted}>{example}</Text>
      </View>
      <Text style={{ color: colors.accent, fontSize: 18 }}>
        {selected ? TEXT.check : ""}
      </Text>
    </Pressable>
  );
}
