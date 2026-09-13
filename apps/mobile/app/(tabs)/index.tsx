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

/**
 * Every user-visible string on this screen, in one place so the later
 * message-catalog sweep is mechanical (AGENTS.md → *User-visible text*).
 */
const TEXT = {
  /** Nothing left on Today or in Belated — the day's finish line. */
  allDone: "All done for today. Go enjoy it.",
  /** The affordance on every row, not a word — see {@link ReminderRow}. It sits
   *  here anyway because it is drawn as text, and this is where this screen's
   *  text lives. */
  chevron: "›",
} as const;

/**
 * How each section announces itself, and — because the two are the same
 * decision — what it says.
 *
 * **The sections you open are buttons; the ones that merely name a group are
 * headings** *(owner, 2026-09-13)*. Belated, Today and Completed are labels over
 * rows: Belated and Today cannot be folded at all, and Completed is the archive
 * at the foot of the list. *Next 7 days* and *Later* are neither — each is a
 * closed door, and the only thing on the screen asking to be pressed. A heading
 * that happens to be tappable gives no sign of it, which is exactly the
 * complaint: *Later* looked like a caption for rows that were not there. They
 * wear {@link styles.buttonSecondary}, the same quiet button a reminder offers
 * its "Remind me tomorrow" on, so the one gesture the list invites looks the
 * same wherever it appears.
 *
 * A button's count is **inside its label**, where a heading's sits opposite the
 * title — a centred label with a number floated to the edge would read as two
 * controls. That is why these are functions rather than strings: a message that
 * takes a value is the catalog's to compose, so plural rules and word order stay
 * the language's business rather than being glued together here (AGENTS.md →
 * *User-visible text*).
 *
 * Keyed over every section, so a new one cannot be added without saying which
 * of the two it is.
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
 * The Reminders tab — the app's home/landing screen, so it lives at the `(tabs)`
 * group's `index` route. A list of reminders **split by when**: belated and
 * today lead (what is *owed* — everything that can be done now), then *Next 7
 * days*, with *Later* inside it, and completed — the two upcoming sections
 * folded away behind buttons, completed behind its own heading (see
 * {@link SECTION_CHROME}). The reasoning for the split —
 * and for why only the owed sections decide whether the day is finished — is on
 * `bucketReminders`; the flat-list shape it renders as is in
 * {@link reminderListItems}, and this screen owns only how it looks.
 *
 * **Every row is a link and nothing else.** Everything a reminder can be — done,
 * put off, dismissed, answered, acted on — lives on its detail screen, one tap
 * away. This screen writes nothing at all.
 *
 * That is a change from the row that carried a completion checkbox on its
 * leading edge, and the reason it went is that a tick had stopped summarizing
 * the row: what a reminder chiefly offers is now a call to action, a *not now*
 * or a *don't ask again* as often as it is an errand to finish, and a checkbox
 * can neither say that nor stand for it. It was also the one control on Home
 * that could destroy something — the mis-tap that silently completed a fixture
 * in an early draft of `maestro/e2e/05-reminder-mention-tag.yaml`, and the tap
 * that parked an onboarding nudge in *Completed* forever without spending a
 * snooze or recording a dismissal.
 *
 * Its removal took the list's sticky-ordering with it. Nothing here re-sorts,
 * because nothing here writes, so there is no tapped row to hold still under a
 * finger — see {@link reminderListItems}.
 *
 * Creating a reminder is the **➕** in this screen's own top-right corner,
 * declared with its title in `app/(tabs)/_layout.tsx`; it goes straight to the
 * reminder form and asks nothing on the way. That question — "person, reminder,
 * or gift idea?" — was what a create control shared with every other screen had
 * to ask here, and this screen had already answered it.
 *
 * That split is why this screen reads nothing but the list. The gift targets and
 * the duplicates-nudge id it used to fetch existed only to decide which offers a
 * row rendered; the screen that renders them now fetches them instead.
 *
 * It reads `listInWindow` rather than `list`: the sections turn on two dates
 * only the engine can supply, and rows not on display yet are not rows at all.
 *
 * A snoozed reminder waits in *Next 7 days* or *Later*, counting down to the day
 * it comes back, and its detail screen offers everything it did before it was
 * put off. Completing it clears the snooze, so reopening it brings it straight
 * back to Today rather than behind a clock nobody could see.
 */
export default function RemindersScreen() {
  const core = useCore();
  const load = useCallback(() => core.reminders.listInWindow(), [core]);
  const { data: reminders, error } = useFocusedData(load);
  // Called before the early returns below, not beside the list it decorates:
  // it is a hook, and the loading and error branches leave without a list.
  const scrollProps = useHeaderScroll();
  // The upcoming sections and completed start folded: none is what the user
  // opened the app for, and each is unbounded in a way the owed sections are not.
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
        // Grown so the empty state can centre itself in the space the reminders
        // would have filled; the rows' padding comes from the screen around it.
        contentContainerStyle={styles.listContent}
        data={items}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <EmptyState
            message="No reminders yet."
            actions={[{ href: "/reminders/new", label: "+ Add a reminder" }]}
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

/**
 * One section heading, with its row count. A collapsible one is the whole
 * heading, not a chevron beside it — the same reason a reminder row is one big
 * target rather than several small ones.
 *
 * Only the sections {@link SECTION_CHROME} calls headings arrive here; the ones
 * you open wear {@link SectionButton} instead.
 */
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
 * A section that opens from a button — see {@link SECTION_CHROME} for why these
 * two are not headings.
 *
 * It stays a button once open, rather than turning into a heading: it is still
 * the control that closes the section again, and a control that changes shape
 * when you use it is one you have to re-learn. `expanded` is what says which way
 * it will go, to a screen reader and to nothing else — the label is the same
 * either way, because the count is the useful half and it is true in both
 * states.
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
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      onPress={onToggle}
      style={[styles.buttonSecondary, styles.buttonBlock, styles.sectionButton]}
    >
      <Text style={styles.buttonSecondaryText}>{label}</Text>
    </Pressable>
  );
}

/**
 * One reminder row: its heading (and body, when it has both) over its due-in,
 * with a chevron closing the line.
 *
 * **The whole row is one link, and the chevron is why it says so.** A phone has
 * no room for a row that is several small targets, so the row is one big one —
 * which is also why the tags and mentions inside it are highlighted but not
 * separately tappable (`linkAnnotations`): on a detail screen they lead to their
 * own pages, but here they would be millimetre-wide traps inside the region the
 * user is aiming at. The chevron is drawn on **every** row rather than only on
 * the onboarding nudges: every row now leads somewhere and does nothing else, so
 * marking a subset would say the rest are inert.
 *
 * ⚠️ **The row is named rather than composed.** An `accessible` container reads
 * its children out in order, which would end every announcement on the chevron,
 * so the row carries its own label instead — the reminder's own name, from
 * `reminderLabel`. The due-in is lost from that announcement and stays lost:
 * gluing it on would be building a sentence out of fragments, which is the one
 * thing AGENTS.md → *User-visible text* forbids outright.
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
  // Title leads; the body shows underneath as details. With no title the body
  // *is* the heading, so it isn't repeated below.
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

/**
 * A row's countdown in words. The date and which words it gets are
 * `reminderCountdownOf`'s choice, so the number a row shows is the date its
 * section sorts it by — Today counts down to the deadline, the later sections to
 * the day a row comes back or arrives.
 */
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
