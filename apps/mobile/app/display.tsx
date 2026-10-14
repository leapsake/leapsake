import { ScrollView, Text } from "react-native";
import { Stack } from "expo-router";
import {
  DATE_FORMATS,
  type DateFormat,
  formatDate,
  todayCivil,
} from "@leapsake/schema";
import { useMessages } from "@leapsake/ui/messages";
import { SelectField } from "../components/SelectField";
import { useDateFormat, useDateFormatSetting } from "../lib/date-format";
import { showFormProblem } from "../lib/form-problem";
import { styles } from "../lib/styles";

/** Settings → Display: how the app writes things out, starting with dates. */
export default function DisplayScreen() {
  const m = useMessages();
  const { choose } = useDateFormatSetting();
  const dateFormat = useDateFormat();
  const today = todayCivil();

  function pick(format: DateFormat) {
    choose(format).catch((cause) => {
      console.error("saving the date format failed:", cause);
      showFormProblem(m.display.saveFailed);
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: m.display.title }} />
      <Text style={styles.muted}>{m.display.intro}</Text>
      <SelectField
        label={m.display.dateFormat}
        value={dateFormat}
        options={DATE_FORMATS.map((format) => ({
          value: format,
          label: m.display.dateFormatOption(
            m.display.dateFormatLabel[format],
            formatDate(today, format),
          ),
        }))}
        onChange={pick}
        testID="display-date-format"
      />
    </ScrollView>
  );
}
