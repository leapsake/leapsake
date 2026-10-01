import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link, Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { DuplicateCandidate, PersonView } from "@leapsake/core";
import { type Person, fullName } from "@leapsake/schema";
import { comparePair } from "@leapsake/view-models";
import { HeaderBack } from "../components/AppHeader";
import { useCore } from "../lib/core-context";
import { deviceRegion } from "../lib/device-region";
import { personFacts } from "../lib/duplicate-pair";
import { personHref } from "../lib/record-title";
import { useFocusedData } from "../lib/useFocusedData";
import { styles } from "../lib/styles";

/** Human-friendly tier copy; falls back to the raw tier if ever extended. */
const TIER_LABEL: Record<string, string> = {
  high: "Very likely the same",
  medium: "Possibly the same",
};

const TEXT = {
  title: "Review duplicates",
  scopedTitle: "Already have them?",
  intro:
    "These two might be the same person. Merge them if they are; otherwise mark them so they stop being suggested.",
  scopedIntro: (name: string) =>
    `${name} might be someone already in your list. Merge them if they’re the same; otherwise mark them so they stop being suggested.`,
  progress: (n: number, total: number) => `${n} of ${total}`,
  inBoth: "In both",
  different: "Different",
  absent: "—",
  merge: "Merge",
  notTheSame: "Not the same",
  skip: "Skip for now",
  notNow: "Not now",
  continue: "Continue",
  none: "No possible duplicates found.",
  scopedNone: "Nothing else looks like the same person.",
  mergeTitle: "Merge these two?",
  mergeMessage:
    "Everything on one moves onto the other, and the extra record is deleted. This can’t be undone.",
  nameTitle: "Which name do you want to keep?",
  nameMessage:
    "Everything else on both is kept. The other record is deleted. This can’t be undone.",
  keep: (name: string) => `Keep “${name}”`,
  cancel: "Cancel",
  mergeFailed: "Couldn’t merge",
  saveFailed: "Couldn’t save",
} as const;

/** Whether two people are named alike in every part, middle name included. */
function sameName(a: Person, b: Person): boolean {
  return (
    a.firstName === b.firstName &&
    a.middleName === b.middleName &&
    a.lastName === b.lastName
  );
}

/** A candidate pair with both people's pages loaded. */
interface Pair {
  candidate: DuplicateCandidate;
  a: PersonView;
  b: PersonView;
}

/**
 * One candidate pair at a time, all or `?for=` one person's, compared field by
 * field. Scoped is a prompt, so "Not now" always leads on.
 */
export default function DuplicatesScreen() {
  const core = useCore();
  const router = useRouter();
  const { for: focusId } = useLocalSearchParams<{ for?: string }>();
  const scoped = typeof focusId === "string" && focusId !== "";
  // How many pairs were skipped, so the next one shows; wraps at the end.
  const [skipped, setSkipped] = useState(0);

  const load = useCallback(async () => {
    const focus = scoped ? await core.people.get(focusId) : undefined;
    // The person may have just been merged away: fall back to every pair.
    const candidates =
      focus === undefined
        ? await core.duplicates.findCandidates()
        : await core.duplicates.findFor(focus.id);
    const index = candidates.length === 0 ? 0 : skipped % candidates.length;
    const pair = candidates[index];
    if (pair === undefined)
      return { candidates, focus: focus ?? null, index, pair: null };
    const [a, b] = await Promise.all([
      core.views.person(pair.a.id),
      core.views.person(pair.b.id),
    ]);
    return {
      candidates,
      focus: focus ?? null,
      index,
      pair: a === null || b === null ? null : { candidate: pair, a, b },
    };
  }, [core, scoped, focusId, skipped]);

  const { data, error, reload } = useFocusedData(load);

  function reject(candidate: DuplicateCandidate) {
    core.duplicates.reject(candidate.a.id, candidate.b.id).then(
      () => reload(),
      (e: unknown) => Alert.alert(TEXT.saveFailed, String(e)),
    );
  }

  /** Merge the pair, asking which name to keep only when the names differ:
   *  everything else on both moves onto whichever is kept. */
  function confirmMerge({ a, b }: Pair) {
    const merge = (survivor: Person, duplicate: Person) =>
      core.people.merge(survivor.id, duplicate.id).then(
        () => reload(),
        (e: unknown) => Alert.alert(TEXT.mergeFailed, String(e)),
      );
    if (sameName(a.person, b.person)) {
      Alert.alert(TEXT.mergeTitle, TEXT.mergeMessage, [
        { text: TEXT.cancel, style: "cancel" },
        {
          text: TEXT.merge,
          style: "destructive",
          onPress: () => merge(a.person, b.person),
        },
      ]);
      return;
    }
    // Neither name is red, so neither reads as the safer choice.
    Alert.alert(TEXT.nameTitle, TEXT.nameMessage, [
      {
        text: TEXT.keep(fullName(a.person)),
        onPress: () => merge(a.person, b.person),
      },
      {
        text: TEXT.keep(fullName(b.person)),
        onPress: () => merge(b.person, a.person),
      },
      { text: TEXT.cancel, style: "cancel" },
    ]);
  }

  const focus = data?.focus ?? null;
  const candidates = data?.candidates ?? null;
  // Once every pair is settled, what Back would return to may be gone with
  // them (the reminder that led here), so Back leaves the whole stack.
  const cleared = !scoped && candidates !== null && candidates.length === 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: focus !== null ? TEXT.scopedTitle : TEXT.title,
          headerBackVisible: !cleared,
          gestureEnabled: !cleared,
          headerLeft: cleared
            ? () => <HeaderBack onPress={() => router.dismissAll()} />
            : undefined,
        }}
      />
      {error !== null ? (
        <View style={styles.screen}>
          <Text style={styles.danger}>{error}</Text>
        </View>
      ) : data === null ? (
        <View style={styles.screen}>
          <ActivityIndicator />
        </View>
      ) : data.pair === null ? (
        <View style={styles.screen}>
          <Text style={styles.muted}>
            {focus !== null ? TEXT.scopedNone : TEXT.none}
          </Text>
          {focus !== null && (
            <Pressable
              accessibilityRole="button"
              style={[styles.button, styles.buttonBlock]}
              onPress={() => router.replace(personHref(focus))}
            >
              <Text style={styles.buttonText}>{TEXT.continue}</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.screen}>
          <Text style={styles.muted}>
            {focus !== null ? TEXT.scopedIntro(fullName(focus)) : TEXT.intro}
          </Text>
          <PairComparison
            pair={data.pair}
            position={TEXT.progress(data.index + 1, data.candidates.length)}
          />
          <View style={styles.rowOffers}>
            <Pressable
              accessibilityRole="button"
              style={[
                styles.button,
                styles.buttonDestructive,
                styles.buttonBlock,
              ]}
              onPress={() => {
                if (data.pair !== null) confirmMerge(data.pair);
              }}
            >
              <Text style={styles.buttonText}>{TEXT.merge}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={[styles.buttonSecondary, styles.buttonBlock]}
              onPress={() => {
                if (data.pair !== null) reject(data.pair.candidate);
              }}
            >
              <Text style={styles.buttonSecondaryText}>{TEXT.notTheSame}</Text>
            </Pressable>
            {/* Scoped, "Not now" is the one way past, skipping them all. */}
            {focus === null && data.candidates.length > 1 && (
              <Pressable
                accessibilityRole="button"
                style={[styles.buttonSecondary, styles.buttonBlock]}
                onPress={() => setSkipped((n) => n + 1)}
              >
                <Text style={styles.buttonSecondaryText}>{TEXT.skip}</Text>
              </Pressable>
            )}
            {/* Never a dead end: skipping leaves the pairs outstanding, and
                they stay linked from three other surfaces until resolved. */}
            {focus !== null && (
              <Pressable
                accessibilityRole="button"
                style={[styles.buttonSecondary, styles.buttonBlock]}
                onPress={() => router.replace(personHref(focus))}
              >
                <Text style={styles.buttonSecondaryText}>{TEXT.notNow}</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      )}
    </>
  );
}

/** The pair side by side: each name links to its page, then what the two
 *  share and what differs. */
function PairComparison({ pair, position }: { pair: Pair; position: string }) {
  const { candidate, a, b } = pair;
  const region = deviceRegion();
  const { shared, differing } = comparePair(
    personFacts(a, region),
    personFacts(b, region),
  );

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {TIER_LABEL[candidate.tier] ?? candidate.tier}
        </Text>
        <Text style={styles.muted}>{position}</Text>
      </View>
      <View style={[styles.row, local.columns]}>
        {[a.person, b.person].map((person) => (
          <Link key={person.id} href={personHref(person)} style={local.column}>
            <Text style={styles.link}>{fullName(person)} ›</Text>
          </Link>
        ))}
      </View>

      {shared.length > 0 && (
        <Text style={[styles.sectionTitle, local.heading]}>{TEXT.inBoth}</Text>
      )}
      {shared.map(({ field, values }) => (
        <View key={field} style={[styles.row, styles.field]}>
          <Text style={styles.fieldLabel}>{field}</Text>
          {values.map((value) => (
            <Text key={value} style={styles.fieldValue}>
              {value}
            </Text>
          ))}
        </View>
      ))}

      {differing.length > 0 && (
        <Text style={[styles.sectionTitle, local.heading]}>
          {TEXT.different}
        </Text>
      )}
      {differing.map(({ field, a: onlyA, b: onlyB }) => (
        <View key={field} style={[styles.row, styles.field]}>
          <Text style={styles.fieldLabel}>{field}</Text>
          <View style={local.columns}>
            {[onlyA, onlyB].map((values, side) => (
              <View key={side} style={local.column}>
                {values.length === 0 ? (
                  <Text style={[styles.fieldValue, styles.muted]}>
                    {TEXT.absent}
                  </Text>
                ) : (
                  values.map((value) => (
                    <Text key={value} style={styles.fieldValue}>
                      {value}
                    </Text>
                  ))
                )}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const local = StyleSheet.create({
  // The two people, left and right, in the same order on every row.
  columns: {
    flexDirection: "row",
    gap: 16,
  },
  column: {
    flex: 1,
  },
  heading: {
    marginTop: 12,
  },
});
