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
import { SelectField } from "./SelectField";
import { styles } from "../lib/styles";

/** The action options in registry order, with their icon + label, for the picker.
 *  Neither `plan` (the engine's own question, never a rule a user schedules) nor
 *  the channel actions are among them — see `SCHEDULABLE_ACTIONS`. */
const ACTION_OPTIONS: { value: ReminderAction; label: string }[] =
  SCHEDULABLE_ACTIONS.map((a) => ({
    value: a,
    label: `${actionDefOf(a).icon ? `${actionDefOf(a).icon} ` : ""}${actionDefOf(a).label}`,
  }));

/**
 * The staggered-reminder editor for a milestone (mobile port of the desktop
 * `ReminderScheduleFields`): a list of rules, each an action (get a gift, send a
 * card…) some number of days before the milestone, on or off. Seeded from the
 * kind's defaults (or the milestone's stored rules when editing) by the parent
 * {@link MilestoneFields}; controlled — every edit calls `onChange` with the next
 * array. `other` reveals a free-text label, mirroring the `other` milestone kind.
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
  // What Add appends is `@leapsake/schema`'s decision, not this component's:
  // there are two of these editors and a locally-chosen seed drifts.
  const add = () => onChange([...value, nextSchedulableRule(value)]);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Reminders</Text>
      {value.length === 0 ? (
        <Text style={styles.muted}>No reminders for this milestone.</Text>
      ) : null}
      {value.map((rule, i) => (
        // Rows are positional (no stable id until saved), so the index is the key.
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
            <Pressable accessibilityRole="button" onPress={() => remove(i)}>
              <Text style={styles.link}>Remove</Text>
            </Pressable>
          </View>
          <SelectField
            label="Action"
            value={rule.action}
            options={ACTION_OPTIONS}
            onChange={(action) =>
              // Entering `other` needs an editable label; leaving it clears one.
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
      <Pressable
        accessibilityRole="button"
        onPress={add}
        style={[styles.button, { alignSelf: "flex-start" }]}
      >
        <Text style={styles.buttonText}>Add reminder</Text>
      </Pressable>
    </View>
  );
}
