import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, Stack } from "expo-router";
import { Contact, requestPermissionsAsync } from "expo-contacts";
import { CONTACT_FIELDS } from "../lib/device-contact-fields";
import { deviceContactToParsed } from "../lib/device-contacts";
import { styles } from "../lib/styles";

/**
 * Dev-only probe for "the device has this birthday but the import didn't get it".
 *
 * `expo-contacts` reads a contact two different ways, and the difference is the
 * whole point of this screen:
 *
 * - **Bulk** — `Contact.getAllDetails(fields)` runs `CNContactFetchRequest`
 *   through `enumerateContacts`, which `ContactRepository.getPaginated` builds
 *   with `unifyResults = false`. This is what the importer uses.
 * - **Per contact** — `new Contact(id).getBirthday()` goes through `getById`,
 *   which is `store.unifiedContact(withIdentifier:)` — *unified*, a different
 *   fetch entirely.
 *
 * So a row where `bulk` is empty and `unified` is not localises the loss to the
 * bulk read, upstream of anything Leapsake owns. Both empty, with the date
 * visible in the iOS Contacts app, points at the fetch keys or the source record
 * instead. It also prints the raw `dates` array, so an anniversary or an
 * Android-style birthday-labelled entry can be seen exactly as the platform
 * returns it, next to what the mapper made of it.
 *
 * Reached by deep link only (`leapsake://dev-contact-dates`), gated by `__DEV__`
 * and linked from no shipping screen — the same conditions as `dev-selftest`,
 * and the same caveat applies: it still ships in the release JS bundle behind an
 * unreachable gate.
 */
export default function DevContactDatesScreen() {
  if (!__DEV__) return <Redirect href="/" />;
  return <ContactDatesProbe />;
}

/** One contact, read both ways. `null` means the read returned nothing. */
interface Probe {
  id: string;
  name: string;
  bulkBirthday: unknown;
  bulkDates: unknown;
  unifiedBirthday: unknown;
  unifiedError: string | null;
  mappedBirthday: unknown;
  mappedDates: unknown;
}

function ContactDatesProbe() {
  const [name, setName] = useState("");
  const [probes, setProbes] = useState<Probe[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    setProbes(null);
    try {
      const permission = await requestPermissionsAsync();
      if (!permission.granted) throw new Error("Contacts permission denied");

      // Same fields the importer asks for, so this reproduces its read exactly.
      // `name` narrows via the platform's own predicate; empty reads everyone.
      const details = await Contact.getAllDetails(CONTACT_FIELDS, {
        ...(name.trim() === "" ? {} : { name: name.trim() }),
        limit: 25,
      });

      const out: Probe[] = [];
      for (const detail of details) {
        const record = detail as Record<string, unknown> & { id: string };
        let unifiedBirthday: unknown = null;
        let unifiedError: string | null = null;
        try {
          unifiedBirthday = await new Contact(record.id).getBirthday();
        } catch (cause) {
          unifiedError = String(cause);
        }
        const mapped = deviceContactToParsed(
          detail as Parameters<typeof deviceContactToParsed>[0],
        );
        out.push({
          id: record.id,
          name:
            (record.fullName as string | null) ??
            `${(record.givenName as string | null) ?? ""} ${
              (record.familyName as string | null) ?? ""
            }`.trim(),
          bulkBirthday: record.birthday ?? null,
          bulkDates: record.dates ?? null,
          unifiedBirthday,
          unifiedError,
          mappedBirthday: mapped.birthday,
          mappedDates: mapped.dates,
        });
      }
      setProbes(out);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Contact dates probe" }} />
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.muted}>
          Reads contacts the way the importer does, then re-reads each one
          through the unified per-contact path. A birthday present under
          “unified” but missing under “bulk” means the bulk fetch is losing it.
        </Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Name filter (blank = first 25)</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoCorrect={false}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          style={[styles.button, running && { opacity: 0.5 }]}
          disabled={running}
          onPress={() => void run()}
        >
          <Text style={styles.buttonText}>{running ? "Reading…" : "Read"}</Text>
        </Pressable>

        {running && <ActivityIndicator />}
        {error !== null && <Text style={styles.danger}>{error}</Text>}

        {probes?.length === 0 && (
          <Text style={styles.muted}>No contacts matched.</Text>
        )}

        {probes?.map((p) => (
          <View key={p.id} style={styles.section}>
            <Text style={styles.sectionTitle}>
              {p.name === "" ? "(unnamed)" : p.name}
            </Text>
            <Row label="bulk birthday" value={p.bulkBirthday} />
            <Row label="unified birthday" value={p.unifiedBirthday} />
            {p.unifiedError !== null && (
              <Text style={styles.danger}>unified error: {p.unifiedError}</Text>
            )}
            <Row label="bulk dates" value={p.bulkDates} />
            <Row label="mapped birthday" value={p.mappedBirthday} />
            <Row label="mapped dates" value={p.mappedDates} />
          </View>
        ))}
      </ScrollView>
    </>
  );
}

function Row({ label, value }: { label: string; value: unknown }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowText}>{label}</Text>
      <Text style={styles.muted} selectable>
        {value === null || value === undefined ? "—" : JSON.stringify(value)}
      </Text>
    </View>
  );
}
