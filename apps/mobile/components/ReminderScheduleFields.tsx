import { Pressable, Text, TextInput, View } from "react-native";
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
import { RowMenu, rowMenuItem } from "./RowMenu";
import { SelectField } from "./SelectField";
import { styles } from "../lib/styles";
import { Button } from "./Button";

/** The schedulable actions, in registry order (`SCHEDULABLE_ACTIONS`). */
const ACTION_OPTIONS: { value: ReminderAction; label: string }[] =
  SCHEDULABLE_ACTIONS.map((a) => ({
    value: a,
    label: `${actionDefOf(a).icon ? `${actionDefOf(a).icon} ` : ""}${actionDefOf(a).label}`,
  }));

/**
 * A milestone's reminder rules, each an action some days before it, on or off;
 * `other` reveals a free-text label.
 */
export function ReminderScheduleFields({
  value,
  onChange,
}: {
  value: ReminderRuleInput[];
  onChange: (next: ReminderRuleInput[]) => void;
}) {
  const update = (index: number, patch: Partial<ReminderRuleInput>) =>
    onChange(
      value.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  const remove = (index: number) =>
    onChange(value.filter((_, i) => i !== index));
  // The schema picks what Add appends, so the two editors cannot drift.
  const add = () => onChange([...value, nextSchedulableRule(value)]);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Reminders</Text>
      {value.length === 0 ? (
        <Text style={styles.muted}>No reminders for this milestone.</Text>
      ) : null}
      {value.map((rule, i) => (
        // Rows have no id until saved, so the index is the key.
        <View key={i} style={{ marginBottom: 16 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: rule.enabled }}
              accessibilityLabel={reminderRuleLabel(rule)}
              onPress={() => update(i, { enabled: !rule.enabled })}
              style={styles.rowWithLead}
            >
              <CheckboxBox checked={rule.enabled} />
              <Text style={styles.fieldValue}>Remind me</Text>
            </Pressable>
            <RowMenu
              subject={reminderRuleLabel(rule)}
              items={[rowMenuItem.remove(() => remove(i))]}
            />
          </View>
          <SelectField
            label="Action"
            value={rule.action}
            options={ACTION_OPTIONS}
            onChange={(action) =>
              // `other` needs a label; leaving it clears one.
              update(i, {
                action,
                label: verbOf(action) === "other" ? (rule.label ?? "") : null,
              })
            }
          />
          {verbOf(rule.action) === "other" ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                Custom action (e.g. Send flowers)
              </Text>
              <TextInput
                style={styles.input}
                value={rule.label ?? ""}
                onChangeText={(text) => update(i, { label: text })}
              />
            </View>
          ) : null}
          <Text style={styles.fieldLabel}>Days before</Text>
          <TextInput
            style={styles.input}
            value={String(rule.offsetDays)}
            onChangeText={(text) =>
              update(i, {
                offsetDays: Math.max(0, Math.trunc(Number(text) || 0)),
              })
            }
            keyboardType="number-pad"
          />
        </View>
      ))}
      <Button
        label="Add reminder"
        onPress={add}
        style={{ alignSelf: "flex-start" }}
      />
    </View>
  );
}
