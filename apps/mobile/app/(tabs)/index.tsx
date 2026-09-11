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
import { formatDueIn, reminderLabel } from "@leapsake/schema";
import { EmptyState } from "../../components/EmptyState";
import { ReminderText } from "../../components/ReminderText";
import { useCore } from "../../lib/core-context";
import {
  type ReminderHeaderItem,
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
const TEXT: Record<ReminderSection, string> & {
  noneOwed: string;
  allClear: string;
  chevron: string;
} = {
  "past-due": "Past due",
  belated: "Belated",
  today: "Today",
  available: "Available",
  coming: "Coming",
  done: "Completed",
  /** Nothing owed, but something is still there to do if you want to. */
  noneOwed: "Nothing owed today.",
  /** Nothing owed and nothing available either. */
  allClear: "Nothing to do. You’re all caught up.",
  /** The affordance on every row, not a word — see {@link ReminderRow}. It sits
   *  here anyway because it is drawn as text, and this is where this screen's
   *  text lives. */
  chevron: "›",
};

/**
 * The Reminders tab — the app's home/landing screen, so it lives at the `(tabs)`
 * group's `index` route. A list of reminders **split by when**: past due,
 * belated and today lead (what is *owed*), then available, then coming and
 * completed folded away behind their own headings. The reasoning for the split —
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
 * only the engine can supply, and *coming* rows are not rows yet at all.
 *
 * Snoozed reminders show nowhere. The bucketing hands back a snoozed bucket and
 * this screen deliberately ignores it: a surface for it would hand the user a
 * way to *complete* a snoozed row, which reopens the still-open question of
 * whether reopening should clear a running clock (`plans/v0-2.md`).
 */
export default function RemindersScreen() {
  const core = useCore();
  const load = useCallback(() => core.reminders.listInWindow(), [core]);
  const { data: reminders, error } = useFocusedData(load);
  // Called before the early returns below, not beside the list it decorates:
  // it is a hook, and the loading and error branches leave without a list.
  const scrollProps = useHeaderScroll();
  // Coming and completed start folded: neither is what the user opened the app
  // for, and both are unbounded in a way the owed sections are not.
  const [collapsed, setCollapsed] = useState<ReadonlySet<ReminderSection>>(
    () => new Set<ReminderSection>(["coming", "done"]),
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
            return (
              <Text style={styles.muted}>
                {item.allClear ? TEXT.allClear : TEXT.noneOwed}
              </Text>
            );
          if (item.kind === "header")
            return (
              <SectionHeader
                item={item}
                onToggle={() => toggleSection(item.section)}
              />
            );
          return <ReminderRow reminder={item.reminder} />;
        }}
      />
    </View>
  );
}

/**
 * One section heading, with its row count. A collapsible one is the whole
 * heading, not a chevron beside it — the same reason a reminder row is one big
 * target rather than several small ones.
 */
function SectionHeader({
  item,
  onToggle,
}: {
  item: ReminderHeaderItem;
  onToggle: () => void;
}) {
  const heading = (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{TEXT[item.section]}</Text>
      <Text style={styles.muted}>{item.count}</Text>
    </View>
  );
  if (!item.collapsible) return heading;
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityState={{ expanded: !item.collapsed }}
      onPress={onToggle}
    >
      {heading}
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
function ReminderRow({ reminder }: { reminder: ReminderInWindow }) {
  const router = useRouter();
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
        {reminder.dueDate !== null && (
          <View style={styles.rowMeta}>
            <Text style={styles.muted}>{formatDueIn(reminder.dueDate)}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.chevron, styles.rowChevron]}>{TEXT.chevron}</Text>
    </Pressable>
  );
}
