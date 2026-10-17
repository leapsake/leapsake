import { useCallback } from "react";
import { ScrollView, Text } from "react-native";
import { Stack } from "expo-router";
import { useMessages } from "@leapsake/ui/messages";
import { CountryField } from "../components/CountryField";
import { LoadState } from "../components/LoadState";
import { useCore } from "../lib/core-context";
import { showFormProblem } from "../lib/form-problem";
import { useFocusedData } from "../lib/useFocusedData";
import { styles } from "../lib/styles";

/** Settings → Country: your country, and where it came from. Clearing a
 *  choice goes back to your address or the device's region. */
export default function YourCountryScreen() {
  const m = useMessages();
  const core = useCore();
  const load = useCallback(() => core.preferences.getYourCountry(), [core]);
  const { data, error, reload } = useFocusedData(load);

  if (error !== null || data === null) {
    return <LoadState error={error} header={{ title: m.yourCountry.title }} />;
  }

  function pick(code: string | null) {
    core.preferences.setCountry(code).then(reload, (cause) => {
      console.error("saving your country failed:", cause);
      showFormProblem(m.yourCountry.saveFailed);
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: m.yourCountry.title }} />
      <Text style={styles.muted}>{m.yourCountry.intro}</Text>
      <CountryField value={data.country} onChange={pick} />
      {data.source !== null && (
        <Text style={styles.muted}>{m.yourCountry.source[data.source]}</Text>
      )}
    </ScrollView>
  );
}
