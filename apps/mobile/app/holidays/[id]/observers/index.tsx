import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { HolidayDetail, HolidayObserverCandidate } from "@leapsake/core";
import { useCore } from "../../../../lib/core-context";
import { useFocusedData } from "../../../../lib/useFocusedData";
import { styles } from "../../../../lib/styles";

/** The stable identity of a picker row. */
const keyOf = (c: HolidayObserverCandidate) => `${c.bearerType}:${c.bearerId}`;

// "Christmas — who do you celebrate with?", ported from desktop's
// HolidayObservers. The bulk-assignment on-ramp.
//
// This screen is load-bearing rather than convenient. With no implicit source of
// observances (religion isn't recorded, and country lives on contact methods
// rather than on the person), *every* observance starts explicit — so without a
// way to answer for the whole address book in one pass, the feature has no entry
// point and dies of data entry (holidays/research.md §2.12).
export default function HolidayObserversScreen() {
  const core = useCore();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const load = useCallback(
    () => Promise.all([core.holidays.get(id), core.holidays.listObservers(id)]),
    [core, id],
  );
  const { data, error } = useFocusedData(load);

  // Seeded from the loaded rows the first time they arrive; `null` until then,
  // so a re-focus mid-edit can't silently discard unsaved ticks.
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);

  if (error !== null) {
    return (
      <View style={styles.screen}>
        <Text style={styles.danger}>{error}</Text>
      </View>
    );
  }

  if (data === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  const [holiday, candidates]: [
    HolidayDetail | undefined,
    HolidayObserverCandidate[],
  ] = data;

  if (holiday === undefined) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: "Holiday" }} />
        <Text style={styles.muted}>This holiday no longer exists.</Text>
      </View>
    );
  }

  const selected =
    checked ??
    new Set(candidates.filter((c) => c.observes).map((c) => keyOf(c)));
  const allChecked =
    candidates.length > 0 && selected.size === candidates.length;

  function toggle(candidate: HolidayObserverCandidate) {
    const next = new Set(selected);
    const key = keyOf(candidate);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChecked(next);
  }

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(candidates.map(keyOf)));
  }

  function save() {
    setSaving(true);
    // Send an answer for *every* candidate, not just the ticked ones — core
    // decides per row whether that answer needs storing, and an unticked row is
    // how an observance gets cleared or explicitly overridden.
    core.holidays
      .setObservers(
        id,
        candidates.map((candidate) => ({
          bearerType: candidate.bearerType,
          bearerId: candidate.bearerId,
          observes: selected.has(keyOf(candidate)),
        })),
      )
      .then(
        () => router.back(),
        (e: unknown) => {
          setSaving(false);
          Alert.alert("Couldn't save", String(e));
        },
      );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: holiday.name }} />

      {candidates.length === 0 ? (
        <Text style={styles.muted}>
          Add some people first, then come back to say who celebrates.
        </Text>
      ) : (
        <>
          <Text style={styles.sectionTitle}>
            {holiday.name} — who do you celebrate with?
          </Text>

          <View style={styles.row}>
            <Text style={styles.rowText}>Select all ({candidates.length})</Text>
            <Switch value={allChecked} onValueChange={toggleAll} />
          </View>

          {candidates.map((candidate) => (
            <View key={keyOf(candidate)} style={styles.row}>
              <Text style={styles.rowText}>
                {candidate.label}
                {candidate.bearerType === "pet" ? " (pet)" : ""}
              </Text>
              <Switch
                value={selected.has(keyOf(candidate))}
                onValueChange={() => toggle(candidate)}
                accessibilityLabel={candidate.label}
              />
            </View>
          ))}

          <Pressable
            accessibilityRole="button"
            onPress={save}
            disabled={saving}
            style={[styles.button, { alignSelf: "flex-start" }]}
          >
            <Text style={styles.buttonText}>
              {saving
                ? "Saving…"
                : `Save ${selected.size} of ${candidates.length}`}
            </Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}
