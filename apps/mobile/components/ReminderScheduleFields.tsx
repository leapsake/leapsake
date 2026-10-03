import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  type Handover,
  type ReminderAction,
  type ReminderRuleInput,
  SCHEDULABLE_ACTIONS,
  actionDefOf,
  formatAction,
  handoverOf,
  isGivenItem,
  nextSchedulableRule,
  offerLabel,
  parseAction,
  promptItemsOf,
  reminderRuleLabel,
  removeGiving,
  setGiving,
  verbOf,
} from "@leapsake/schema";
import { CheckboxBox } from "./Checkbox";
import { SelectField } from "./SelectField";
import { Sheet } from "./Sheet";
import { styles } from "../lib/styles";
import { Button } from "./Button";

const daysBefore = (days: number) =>
  days === 0
    ? "on the day"
    : days === 1
      ? "1 day before"
      : `${days} days before`;

const TEXT = {
  heading: "Reminders",
  none: "No reminders for this milestone.",
  action: "Action",
  customAction: "Custom action (e.g. Send flowers)",
  daysBefore: "Days before",
  add: "Add reminder",
  remove: "Remove reminder",
  timing: (days: number) =>
    days === 0
      ? "On the day"
      : days === 1
        ? "1 day before"
        : `${days} days before`,
  giveTiming: (getDays: number, how: Handover, postDays: number) =>
    how === "mail"
      ? `Get it ${daysBefore(getDays)}, post it ${daysBefore(postDays)}`
      : `Get it ${daysBefore(getDays)}, give it in person`,
  editRule: (label: string, timing: string) => `${label}, ${timing}. Edit`,
  how: "How you’ll give it",
  mail: "By mail",
  inPerson: "In person",
  getDays: "Days before, to get it",
  postDays: "Days before, to post it",
} as const;

const HANDOVER_OPTIONS: { value: Handover; label: string }[] = [
  { value: "mail", label: TEXT.mail },
  { value: "in-person", label: TEXT.inPerson },
];

const optionOf = (a: ReminderAction) => ({
  value: a,
  label: `${actionDefOf(a).icon ? `${actionDefOf(a).icon} ` : ""}${actionDefOf(a).label}`,
});

/** The schedulable actions a row may become; a delivery goes with its item. */
const ACTION_OPTIONS = SCHEDULABLE_ACTIONS.filter(
  (a) => actionDefOf(a).deliveryOf === undefined,
).map(optionOf);

/** A whole number of days typed into a field; anything else is 0. */
const daysFrom = (text: string) => Math.max(0, Math.trunc(Number(text) || 0));

/**
 * A milestone's reminder rules, one line each: the box turns a rule on or off,
 * and the rest opens a sheet. A gift or card is one line, its delivery inside.
 */
export function ReminderScheduleFields({
  value,
  onChange,
}: {
  value: ReminderRuleInput[];
  onChange: (next: ReminderRuleInput[]) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  // How an unticked gift or card would be given, kept while it is off.
  const [chosen, setChosen] = useState<Partial<Record<string, Handover>>>({});
  const howOf = (item: ReminderAction) =>
    chosen[item] ?? handoverOf(value, item);
  const postingOf = (item: ReminderAction) =>
    value.find(
      (r) => r.action === formatAction("send", parseAction(item).qualifier),
    );

  const update = (index: number, patch: Partial<ReminderRuleInput>) =>
    onChange(
      value.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  const remove = (index: number) => {
    setEditing(null);
    const { action } = value[index]!;
    onChange(
      isGivenItem(action)
        ? removeGiving(value, action)
        : value.filter((_, i) => i !== index),
    );
  };
  const setHow = (item: ReminderRuleInput, how: Handover) => {
    setChosen({ ...chosen, [item.action]: how });
    if (item.enabled) onChange(setGiving(value, item.action, true, how));
  };
  // The schema picks what Add appends, so the two editors cannot drift.
  const add = () => {
    onChange([...value, nextSchedulableRule(value)]);
    setEditing(value.length);
  };

  const open = editing === null ? undefined : value[editing];

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{TEXT.heading}</Text>
      {value.length === 0 ? (
        <Text style={styles.muted}>{TEXT.none}</Text>
      ) : null}
      {promptItemsOf(value).map(({ index: i, rule }) => {
        const given = isGivenItem(rule.action);
        const label = given
          ? offerLabel(rule.action, "")
          : reminderRuleLabel(rule);
        const timing = given
          ? TEXT.giveTiming(
              rule.offsetDays,
              howOf(rule.action),
              postingOf(rule.action)?.offsetDays ?? 7,
            )
          : TEXT.timing(rule.offsetDays);
        return (
          // Rows have no id until saved, so the index is the key.
          <View key={i} style={[styles.row, local.line]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: rule.enabled }}
              accessibilityLabel={label}
              onPress={() =>
                given
                  ? onChange(
                      setGiving(
                        value,
                        rule.action,
                        !rule.enabled,
                        howOf(rule.action),
                      ),
                    )
                  : update(i, { enabled: !rule.enabled })
              }
              hitSlop={12}
            >
              <CheckboxBox checked={rule.enabled} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={TEXT.editRule(label, timing)}
              onPress={() => setEditing(i)}
              style={local.body}
            >
              <View style={styles.rowBody}>
                <Text style={styles.fieldValue}>{label}</Text>
                <Text style={styles.muted}>{timing}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </View>
        );
      })}
      <Button
        label={TEXT.add}
        tone="secondary"
        onPress={add}
        style={{ alignSelf: "flex-start", marginTop: 8 }}
      />

      <Sheet
        visible={open !== undefined}
        onClose={() => setEditing(null)}
        close="done"
        title={
          open === undefined
            ? undefined
            : isGivenItem(open.action)
              ? offerLabel(open.action, "")
              : reminderRuleLabel(open)
        }
        avoidKeyboard
      >
        {open !== undefined && editing !== null && isGivenItem(open.action) ? (
          <View style={local.sheetBody}>
            <SelectField
              label={TEXT.how}
              value={howOf(open.action)}
              options={HANDOVER_OPTIONS}
              onChange={(how) => setHow(open, how)}
            />
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{TEXT.getDays}</Text>
              <TextInput
                style={styles.input}
                value={String(open.offsetDays)}
                onChangeText={(text) =>
                  update(editing, { offsetDays: daysFrom(text) })
                }
                keyboardType="number-pad"
              />
            </View>
            {howOf(open.action) === "mail" &&
            postingOf(open.action) !== undefined ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{TEXT.postDays}</Text>
                <TextInput
                  style={styles.input}
                  value={String(postingOf(open.action)!.offsetDays)}
                  onChangeText={(text) =>
                    update(value.indexOf(postingOf(open.action)!), {
                      offsetDays: daysFrom(text),
                    })
                  }
                  keyboardType="number-pad"
                />
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => remove(editing)}
            >
              <Text style={[styles.link, styles.danger]}>{TEXT.remove}</Text>
            </Pressable>
          </View>
        ) : open !== undefined && editing !== null ? (
          <View style={local.sheetBody}>
            <SelectField
              label={TEXT.action}
              value={open.action}
              options={
                ACTION_OPTIONS.some((o) => o.value === open.action)
                  ? ACTION_OPTIONS
                  : [optionOf(open.action), ...ACTION_OPTIONS]
              }
              onChange={(action) =>
                // `other` needs a label; leaving it clears one.
                update(editing, {
                  action,
                  label: verbOf(action) === "other" ? (open.label ?? "") : null,
                })
              }
            />
            {verbOf(open.action) === "other" ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{TEXT.customAction}</Text>
                <TextInput
                  style={styles.input}
                  value={open.label ?? ""}
                  onChangeText={(text) => update(editing, { label: text })}
                />
              </View>
            ) : null}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{TEXT.daysBefore}</Text>
              <TextInput
                style={styles.input}
                value={String(open.offsetDays)}
                onChangeText={(text) =>
                  update(editing, { offsetDays: daysFrom(text) })
                }
                keyboardType="number-pad"
              />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => remove(editing)}
            >
              <Text style={[styles.link, styles.danger]}>{TEXT.remove}</Text>
            </Pressable>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

const local = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", gap: 12 },
  body: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  sheetBody: { gap: 16, padding: 16 },
});
