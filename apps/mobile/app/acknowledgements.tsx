import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { ACKNOWLEDGEMENTS, type Acknowledgement } from "@leapsake/ui/headless";
import { styles } from "../lib/styles";

// The attribution a user can reach, a licence obligation (the repo's is
// `NOTICE`). The list is shared with desktop; the framing is this screen's.

const TEXT = {
  title: "Acknowledgements",
  intro:
    "Leapsake is built on work that other people made and chose to share. Thank you.",
  licensedUnder: (license: string) => `Licensed under ${license}`,
  openLicense: "Read the licence",
  openProject: "Visit the project",
  openFailed: "Couldn’t open that link",
} as const;

export default function AcknowledgementsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: TEXT.title }} />
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.muted}>{TEXT.intro}</Text>
        <View>
          {ACKNOWLEDGEMENTS.map((entry) => (
            <Credit key={entry.title} entry={entry} />
          ))}
        </View>
      </ScrollView>
    </>
  );
}

/** One credit: what it is, what it does for us, its licence and project. */
function Credit({ entry }: { entry: Acknowledgement }) {
  return (
    <View style={[styles.row, styles.section]}>
      <Text style={styles.sectionTitle}>{entry.title}</Text>
      <Text style={styles.rowText}>{entry.use}</Text>
      <Text style={styles.muted}>{TEXT.licensedUnder(entry.license)}</Text>
      <View style={styles.headerActions}>
        <LinkOut label={TEXT.openLicense} url={entry.licenseUrl} />
        <LinkOut label={TEXT.openProject} url={entry.url} />
      </View>
    </View>
  );
}

/** An outbound link; a failure is the OS declining it, so it is reported. */
function LinkOut({ label, url }: { label: string; url: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        Linking.openURL(url).catch((error: unknown) =>
          Alert.alert(TEXT.openFailed, String(error)),
        );
      }}
    >
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}
