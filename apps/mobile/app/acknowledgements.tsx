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

/**
 * Acknowledgements — the work other people made that Leapsake ships.
 *
 * A licence obligation before it is a courtesy: the app icon is OpenMoji artwork under
 * CC BY-SA 4.0, which asks for attribution wherever the work is distributed, and a shipped
 * app is distribution. The repo's own copy is `NOTICE`; this is the half a user can reach.
 *
 * The list itself is `ACKNOWLEDGEMENTS` in `@leapsake/ui/headless` so both clients credit
 * the same things — a credit that appeared on only one platform would be the bug. Only the
 * framing sentences below belong to this screen.
 *
 * Reached from the Settings tab rather than from Account: it is about the app, not about
 * the person using it. It is deliberately readable with no account and no data, which is
 * also why it touches neither.
 */

/** Kept at the top of the module rather than inline — see AGENTS.md → User-visible text. */
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

/**
 * One credit: what it is, what it does for us, and the two links that matter — the licence
 * (the obligation) and the project (the thanks).
 */
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

/**
 * An outbound link. `Linking.openURL` hands the URL to the OS, so a failure here is the
 * phone declining to handle it rather than anything this screen can fix — it is reported
 * and dropped rather than retried.
 */
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
