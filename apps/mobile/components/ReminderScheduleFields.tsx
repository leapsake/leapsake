import { Pressable, Switch, Text, TextInput, View } from "react-native";
import {
  type ReminderAction,
  type ReminderRuleInput,
  actionDefs,
  reminderActionSchema,
} from "@leapsake/schema";
import { SelectField } from "./SelectField";
import { styles } from "../lib/styles";

/** The action options in registry order, with their icon + label, for the picker. */
const ACTION_OPTIONS: { value: ReminderAction; label: string }[] =
  reminderActionSchema.options.map((a) => ({
    value: a,
    label: `${actionDefs[a].icon ? `${actionDefs[a].icon} ` : ""}${actionDefs[a].label}`,
  }));

/**
 * The staggered-reminder editor for a milestone (mobile port of the desktop
 * `ReminderScheduleFields`): a list of rules, each an action (get a gift, send a
 * card…) some number of days before the milestone, on or off. Seeded from the
 * kind's defaults (or the milestone's stored rules when editing) by the parent
 * {@link MilestoneForm}; controlled — every edit calls `onChange` with the next
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
  const add = () =>
    onChange([
      ...value,
      { action: "call", label: null, offsetDays: 7, enabled: true },
    ]);

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
            <Switch
              value={rule.enabled}
              onValueChange={(on) => update(i, { enabled: on })}
            />
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
                label: action === "other" ? (rule.label ?? "") : null,
              })
            }
          />
          {rule.action === "other" ? (
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
