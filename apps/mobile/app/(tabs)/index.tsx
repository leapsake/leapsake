import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  type GiftReminderTarget,
  type OnboardingRoute,
  onboardingRouteOf,
} from "@leapsake/core";
import {
  type ReminderWithTags,
  compareReminderDue,
  formatDueIn,
  reminderLabel,
} from "@leapsake/schema";
import { ReminderText } from "../../components/ReminderText";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";

/**
 * Each onboarding nudge's abstract {@link OnboardingRoute} mapped to this client's
 * own expo-router path — the tap target its row deep-links to. Looked up by id via
 * {@link onboardingRouteOf}; a non-onboarding reminder taps through to its detail.
 */
const ONBOARDING_PATH: Record<OnboardingRoute, string> = {
  "add-person": "/people/new",
  "connect-sync": "/(tabs)/settings",
  // Pick-yourself deep-links to the People list in its pick mode, where each
  // Person row offers "This is me".
  "pick-self": "/(tabs)/people?pick=self",
};

/**
 * The path a `🎁 gift` reminder's CTA points at, which flips on completion — the
 * loop the reminder itself opens. **Open:** the recipient's own page,
 * whose Gifts section lists what's already suggested for them (and what they've
 * been given, so you don't repeat yourself). **Done:** the capture form fixed to
 * that recipient, to record what you actually gave.
 *
 * Completion is deliberately left as the plain Done action rather than growing a
 * modal: nothing else in reminders interrupts that path, and a link the user can
 * take or ignore respects a "done" that meant "handled, nothing to log".
 */
function giftCtaFor(
  target: GiftReminderTarget,
  done: boolean,
): { path: string; label: string } {
  const party = `${target.recipientType}:${target.recipientId}`;
  return done
    ? {
        path: `/gifts/new?recipient=${encodeURIComponent(party)}`,
        label: "Record what you gave ›",
      }
    : {
        path: `${target.recipientType === "pet" ? "/pets" : "/people"}/${target.recipientId}`,
        label: "See their gifts ›",
      };
}

/**
 * The Reminders tab — the app's home/landing screen, so it lives at the `(tabs)`
 * group's `index` route. A standalone list of user-created reminders: open ones
 * lead; completed ones sink to the bottom with a struck-through label. Each row
 * toggles completion and removes in place (the list reloads without navigating).
 * "+ Add" lives on the tab header (app/(tabs)/_layout.tsx).
 */
export default function RemindersScreen() {
  const core = useCore();
  // The rows plus which of them are `🎁 gift` reminders and who they're about, so
  // a gift reminder can offer the recipient's gifts (and, once done, logging one).
  const load = useCallback(
    () =>
      Promise.all([
        core.reminders.list(),
        core.reminders.giftTargets(),
        // The duplicates nudge is content-addressed on the outstanding pair set,
        // so unlike the onboarding nudges its id can't come from a static table —
        // core recomputes it from the live pairs and the list matches on it.
        core.duplicates.nudgeId(),
      ]),
    [core],
  );
  const { data, error, reload } = useFocusedData(load);

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

  const [reminders, giftTargets, duplicatesNudgeId] = data;
  const giftTargetById = new Map(giftTargets.map((t) => [t.reminderId, t]));
  // Open first (soonest due first, undated sinking below), then completed —
  // completed keeps the repo's newest-first order.
  const ordered = [
    ...reminders.filter((r) => r.completedAt === null).sort(compareReminderDue),
    ...reminders.filter((r) => r.completedAt !== null),
  ];

  return (
    <View style={styles.screen}>
      <FlatList
        data={ordered}
        keyExtractor={(r) => r.id}
        ListEmptyComponent={<Text style={styles.muted}>No reminders yet.</Text>}
        renderItem={({ item }) => (
          <ReminderRow
            reminder={item}
            giftTarget={giftTargetById.get(item.id)}
            isDuplicatesNudge={item.id === duplicatesNudgeId}
            reload={reload}
          />
        )}
      />
    </View>
  );
}

function ReminderRow({
  reminder,
  giftTarget,
  isDuplicatesNudge = false,
  reload,
}: {
  reminder: ReminderWithTags;
  /** Set when this is a `🎁 gift` reminder — see {@link giftCtaFor}. */
  giftTarget?: GiftReminderTarget;
  /** Set when this row is the duplicates nudge, which opens the review. */
  isDuplicatesNudge?: boolean;
  reload: () => Promise<void>;
}) {
  const core = useCore();
  const router = useRouter();
  const done = reminder.completedAt !== null;
  const strike = done
    ? { textDecorationLine: "line-through" as const, color: colors.muted }
    : undefined;
  // Title leads; the body shows underneath as details. With no title the body
  // *is* the heading, so it isn't repeated below.
  const heading = reminder.title ?? reminder.body ?? "";
  // An onboarding nudge deep-links to its target screen instead of a (nonexistent)
  // reminder detail; every other reminder taps through to its detail as before.
  const onboardingRoute = onboardingRouteOf(reminder.id);
  // The duplicates nudge deep-links the same way, to the (unscoped) review.
  const open = () =>
    router.push(
      onboardingRoute !== null
        ? ONBOARDING_PATH[onboardingRoute]
        : isDuplicatesNudge
          ? "/duplicates"
          : `/reminders/${reminder.id}`,
    );
  // A gift reminder carries a due date of its own, so its CTA gets its own line
  // below the meta row rather than competing for that row's left slot.
  const giftCta =
    giftTarget === undefined ? null : giftCtaFor(giftTarget, done);

  function toggle() {
    core.reminders.setCompleted(reminder.id, !done).then(
      () => reload(),
      (e: unknown) => Alert.alert("Couldn't update", String(e)),
    );
  }

  function confirmDelete() {
    Alert.alert("Delete reminder", `Delete “${reminderLabel(reminder)}”?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          core.reminders.softDelete(reminder.id).then(
            () => reload(),
            (e: unknown) => Alert.alert("Couldn't delete", String(e)),
          ),
      },
    ]);
  }

  return (
    <View style={styles.row}>
      <ReminderText
        text={heading}
        tags={reminder.tags}
        mentions={reminder.mentions}
        style={[styles.rowText, strike]}
        onPressText={open}
      />
      {reminder.title !== null && reminder.body !== null && (
        <ReminderText
          text={reminder.body}
          tags={reminder.tags}
          mentions={reminder.mentions}
          style={[styles.muted, strike]}
          onPressText={open}
        />
      )}
      <View style={styles.rowMeta}>
        {reminder.dueDate !== null ? (
          <Text style={styles.muted}>{formatDueIn(reminder.dueDate)}</Text>
        ) : onboardingRoute !== null || isDuplicatesNudge ? (
          // A subtle affordance that the nudge deep-links somewhere (tapping the
          // text routes there); dateless nudges have no due-in to show here.
          <Pressable accessibilityRole="button" onPress={open}>
            <Text style={styles.link}>
              {isDuplicatesNudge ? "Review ›" : "Get started ›"}
            </Text>
          </Pressable>
        ) : (
          <View />
        )}
        <View style={styles.rowActions}>
          <Pressable accessibilityRole="button" onPress={toggle}>
            <Text style={styles.link}>{done ? "Reopen" : "Done"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={confirmDelete}>
            <Text style={[styles.link, styles.danger]}>Remove</Text>
          </Pressable>
        </View>
      </View>
      {giftCta !== null && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(giftCta.path)}
        >
          <Text style={styles.link}>{giftCta.label}</Text>
        </Pressable>
      )}
    </View>
  );
}
