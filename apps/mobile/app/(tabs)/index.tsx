import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import type { ReminderInWindow } from "@leapsake/core";
import { formatDueIn, reminderLabel } from "@leapsake/schema";
import { Checkbox } from "../../components/Checkbox";
import { EmptyState } from "../../components/EmptyState";
import { ReminderText } from "../../components/ReminderText";
import { useCore } from "../../lib/core-context";
import {
  type ReminderHeaderItem,
  type ReminderListPins,
  type ReminderSection,
  NO_PINS,
  pinsFrom,
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
 * Each row toggles completion in place — in place *literally*: the row stays
 * where the user's finger found it, struck through, rather than sliding into the
 * completed section and pulling the next row up under the finger that just
 * tapped it (see `stickyOrder`, and {@link ReminderListPins} for why the
 * *section* has to be held too, not just the order). Every other action a
 * reminder offers lives on its detail screen, which the row text taps through
 * to. Creating one is the **➕** in this screen's own top-right corner, declared
 * with its title in `app/(tabs)/_layout.tsx`; it goes straight to the reminder
 * form and asks nothing on the way. That question — "person, reminder, or gift
 * idea?" — was what a create control shared with every other screen had to ask
 * here, and this screen had already answered it.
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
  const { data: reminders, error, reload } = useFocusedData(load);
  // Called before the early returns below, not beside the list it decorates:
  // it is a hook, and the loading and error branches leave without a list.
  const scrollProps = useHeaderScroll();
  // What the list looked like when one of its rows was last toggled, which the
  // reloaded list is held to so the tapped row doesn't move out from under the
  // finger. Cleared when the screen blurs: leaving is the user's own break in the
  // interaction, and the answer to "when does the list finally re-sort?".
  const [pins, setPins] = useState<ReminderListPins>(NO_PINS);
  // Coming and completed start folded: neither is what the user opened the app
  // for, and both are unbounded in a way the owed sections are not.
  const [collapsed, setCollapsed] = useState<ReadonlySet<ReminderSection>>(
    () => new Set<ReminderSection>(["coming", "done"]),
  );
  useFocusEffect(
    useCallback(
      () => () => {
        setPins(NO_PINS);
      },
      [],
    ),
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

  const items = reminderListItems(reminders, { pins, collapsed });
  // Pinning what is *displayed*, not the natural order, is what makes a second
  // and third tick hold everything still too.
  const pin = () => setPins(pinsFrom(items));
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
          return (
            <ReminderRow reminder={item.reminder} pin={pin} reload={reload} />
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
 * One reminder row: a completion checkbox on the leading edge, beside its heading
 * (and body, when it has both) over its due-in.
 *
 * The checkbox is the row's only write. Everything else a reminder can offer — a
 * nudge's *do it* / *not now* / *don't ask again*, a gift row's link to the
 * recipient, and deletion — is one tap away on the detail screen rather than
 * spread across a list row, so a row can't destroy anything and the list stays
 * scannable. Tapping anywhere else on the row goes there, and the reminder is now
 * the *only* place a tap can land: a nudge used to deep-link straight to the step
 * it asked for (which would strand its put-off and dismiss on a screen the user
 * could no longer reach), and a `#tag` or `@mention` used to be its own link.
 */
function ReminderRow({
  reminder,
  pin,
  reload,
}: {
  reminder: ReminderInWindow;
  /** Freeze the list's current order before this row's write re-sorts it. */
  pin: () => void;
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
  // How this reminder is named, for the checkbox's accessibility label — nothing
  // else here names it now that the row's own buttons are gone.
  const label = reminderLabel(reminder);
  const open = () =>
    router.push({ pathname: "/reminders/[id]", params: { id: reminder.id } });

  function toggle() {
    // Before the write, not after: the order to hold is the one the user was
    // looking at when they aimed at this checkbox.
    pin();
    core.reminders.setCompleted(reminder.id, !done).then(
      () => reload(),
      (e: unknown) => Alert.alert("Couldn’t update", String(e)),
    );
  }

  return (
    <View style={[styles.row, styles.rowWithLead]}>
      {/* The completion toggle — deliberately a sibling of the link below rather
          than inside it, so tapping through to the reminder never flips it, and
          so a screen reader gets two controls rather than one ambiguous one. */}
      <Checkbox
        accessibilityLabel={done ? `Reopen “${label}”` : `Mark “${label}” done`}
        checked={done}
        onPress={toggle}
        style={styles.rowLeadCheckbox}
      />
      {/* Everything but the checkbox is one link to the reminder — the text, the
          due-in, and the empty space beside them. A phone has no room for a row
          that is several small targets, so the row is one big one, and the tags
          and mentions inside it are highlighted but not separately tappable
          (`linkAnnotations`): on a detail screen they lead to their own pages,
          but here they would be millimetre-wide traps inside the region the user
          is aiming at. `accessible` groups the children so a screen reader
          announces the row as the single link it now is. */}
      <Pressable
        accessible
        accessibilityRole="link"
        onPress={open}
        style={styles.rowBody}
      >
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
      </Pressable>
    </View>
  );
}
