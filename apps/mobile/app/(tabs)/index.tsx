import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import type { ReminderInWindow } from "@leapsake/core";
import {
  formatBackIn,
  formatComingIn,
  formatDueCountdown,
  formatDueIn,
  reminderLabel,
} from "@leapsake/schema";
import {
  type ReminderCountdown,
  reminderCountdownOf,
} from "@leapsake/view-models";
import { EmptyState } from "../../components/EmptyState";
import { ReminderText } from "../../components/ReminderText";
import { useCore } from "../../lib/core-context";
import {
  type ReminderSection,
  reminderListItems,
} from "../../lib/reminder-sections";
import { useFocusedData } from "../../lib/useFocusedData";
import { useHeaderScroll } from "../../lib/use-header-scroll";
import { colors, styles } from "../../lib/styles";
import { Button } from "../../components/Button";

/** Every user-visible string on this screen. */
const TEXT = {
  /** Nothing left on Today or in Belated — the day's finish line. */
  allDone: "All done for today. Go enjoy it.",
  /** The affordance on every row, drawn as text. */
  chevron: "›",
} as const;

/**
 * Whether each section is a heading or a button you open, and its words; a
 * button's count is inside its label (the app's README).
 */
type SectionChrome =
  | { as: "heading"; title: string }
  | { as: "button"; label: (count: number) => string };

const SECTION_CHROME: Record<ReminderSection, SectionChrome> = {
  belated: { as: "heading", title: "Belated" },
  today: { as: "heading", title: "Today" },
  next7: { as: "button", label: (count) => `Next 7 days (${count})` },
  later: { as: "button", label: (count) => `Later (${count})` },
  done: { as: "heading", title: "Completed" },
};

/**
 * Home: reminders split by when, each row a link and nothing else. Reads
 * `listInWindow`, since the sections turn on dates only the engine supplies.
 */
export default function RemindersScreen() {
  const core = useCore();
  const load = useCallback(() => core.reminders.listInWindow(), [core]);
  const { data: reminders, error } = useFocusedData(load);
  // A hook, so it runs before the early returns rather than beside the list.
  const scrollProps = useHeaderScroll();
  // The upcoming sections and completed start folded; each is unbounded.
  const [collapsed, setCollapsed] = useState<ReadonlySet<ReminderSection>>(
    () => new Set<ReminderSection>(["next7", "later", "done"]),
  );

  if (error !== null) {
    return (
      <View style={styles.screen}>
        <Text style={styles.danger}>{error}</Text>
      </View>
    );
  }
  if (reminders === null) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  const items = reminderListItems(reminders, { collapsed });
  const toggleSection = (section: ReminderSection) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(section)) next.add(section);
      return next;
    });

  return (
    <View style={styles.screen}>
      <FlatList
        {...scrollProps}
        // Grown so the empty state can centre where the reminders would be.
        contentContainerStyle={styles.listContent}
        data={items}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <EmptyState
            message="No reminders yet."
            actions={[
              { href: "/reminders/new", label: "Add a reminder", glyph: "🔔" },
            ]}
          />
        }
        renderItem={({ item }) => {
          if (item.kind === "note")
            return <Text style={styles.muted}>{TEXT.allDone}</Text>;
          if (item.kind === "header") {
            const chrome = SECTION_CHROME[item.section];
            const onToggle = () => toggleSection(item.section);
            return chrome.as === "button" ? (
              <SectionButton
                label={chrome.label(item.count)}
                collapsed={item.collapsed}
                onToggle={onToggle}
              />
            ) : (
              <SectionHeader
                title={chrome.title}
                count={item.count}
                collapsible={item.collapsible}
                collapsed={item.collapsed}
                onToggle={onToggle}
              />
            );
          }
          return (
            <ReminderRow reminder={item.reminder} section={item.section} />
          );
        }}
      />
    </View>
  );
}

/** A section heading with its count; a collapsible one is all one target. */
function SectionHeader({
  title,
  count,
  collapsible,
  collapsed,
  onToggle,
}: {
  title: string;
  count: number;
  collapsible: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const heading = (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.muted}>{count}</Text>
    </View>
  );
  if (!collapsible) return heading;
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      onPress={onToggle}
    >
      {heading}
    </Pressable>
  );
}

/**
 * A section that opens from a button, and stays one once open. Only
 * `expanded` says which way it goes; the label is the same either way.
 */
function SectionButton({
  label,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      label={label}
      tone="secondary"
      accessibilityState={{ expanded: !collapsed }}
      onPress={onToggle}
      style={styles.sectionButton}
    />
  );
}

/**
 * One row, all one link, so its tags and mentions are not tappable. ⚠️ Named
 * by `reminderLabel`, since composing it would end on the chevron.
 */
function ReminderRow({
  reminder,
  section,
}: {
  reminder: ReminderInWindow;
  section: ReminderSection;
}) {
  const router = useRouter();
  const countdown = reminderCountdownOf(reminder, section);
  const done = reminder.completedAt !== null;
  const strike = done
    ? { textDecorationLine: "line-through" as const, color: colors.muted }
    : undefined;
  // With no title the body is the heading, and is not repeated below.
  const heading = reminder.title ?? reminder.body ?? "";

  return (
    <Pressable
      accessible
      accessibilityRole="link"
      accessibilityLabel={reminderLabel(reminder)}
      onPress={() =>
        router.push({
          pathname: "/reminders/[id]",
          params: { id: reminder.id },
        })
      }
      style={[styles.row, styles.rowWithLead]}
    >
      <View style={styles.rowBody}>
        <ReminderText
          text={heading}
          tags={reminder.tags}
          mentions={reminder.mentions}
          style={[styles.rowText, strike]}
          linkAnnotations={false}
        />
        {reminder.title !== null && reminder.body !== null && (
          <ReminderText
            text={reminder.body}
            tags={reminder.tags}
            mentions={reminder.mentions}
            style={[styles.muted, strike]}
            linkAnnotations={false}
          />
        )}
        {countdown !== null && (
          <View style={styles.rowMeta}>
            <Text style={styles.muted}>{countdownText(countdown)}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.chevron, styles.rowChevron]}>{TEXT.chevron}</Text>
    </Pressable>
  );
}

/** A row's countdown in words; `reminderCountdownOf` picks date and words. */
function countdownText(countdown: ReminderCountdown): string {
  switch (countdown.kind) {
    case "due":
      return formatDueCountdown(countdown.date);
    case "back":
      return formatBackIn(countdown.date);
    case "coming":
      return formatComingIn(countdown.date);
    case "shown":
      return formatDueIn(countdown.date);
  }
}
