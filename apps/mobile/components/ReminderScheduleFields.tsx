import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  type ReminderAction,
  type ReminderRuleInput,
  SCHEDULABLE_ACTIONS,
  actionDefOf,
  nextSchedulableRule,
  reminderRuleLabel,
  verbOf,
} from "@leapsake/schema";
import { CheckboxBox } from "./Checkbox";
import { SelectField } from "./SelectField";
import { Sheet } from "./Sheet";
import { styles } from "../lib/styles";
import { Button } from "./Button";

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
  editRule: (label: string, timing: string) => `${label}, ${timing}. Edit`,
} as const;

/** The schedulable actions, in registry order (`SCHEDULABLE_ACTIONS`). */
const ACTION_OPTIONS: { value: ReminderAction; label: string }[] =
  SCHEDULABLE_ACTIONS.map((a) => ({
    value: a,
    label: `${actionDefOf(a).icon ? `${actionDefOf(a).icon} ` : ""}${actionDefOf(a).label}`,
  }));

/**
 * A milestone's reminder rules, one line each: the box turns a rule on or off,
 * and the rest of the line opens a sheet editing its action and timing.
 */
export function ReminderScheduleFields({
  value,
  onChange,
}: {
  value: ReminderRuleInput[];
  onChange: (next: ReminderRuleInput[]) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);

  const update = (index: number, patch: Partial<ReminderRuleInput>) =>
    onChange(
      value.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  const remove = (index: number) => {
    setEditing(null);
    onChange(value.filter((_, i) => i !== index));
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
      {value.map((rule, i) => {
        const label = reminderRuleLabel(rule);
        const timing = TEXT.timing(rule.offsetDays);
        return (
          // Rows have no id until saved, so the index is the key.
          <View key={i} style={[styles.row, local.line]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: rule.enabled }}
              accessibilityLabel={label}
              onPress={() => update(i, { enabled: !rule.enabled })}
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
        title={open === undefined ? undefined : reminderRuleLabel(open)}
        avoidKeyboard
      >
        {open !== undefined && editing !== null ? (
          <View style={local.sheetBody}>
            <SelectField
              label={TEXT.action}
              value={open.action}
              options={ACTION_OPTIONS}
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
                  update(editing, {
                    offsetDays: Math.max(0, Math.trunc(Number(text) || 0)),
                  })
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
