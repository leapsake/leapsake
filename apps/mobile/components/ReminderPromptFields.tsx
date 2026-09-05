import { Pressable, Switch, Text, View } from "react-native";
import { type ReminderRuleInput, actionDefOf } from "@leapsake/schema";
import { styles } from "../lib/styles";

/**
 * The prompt's answer form (mobile twin of the web `ReminderPromptFields`): one
 * toggle per offered action, and nothing else.
 *
 * Deliberately not {@link ReminderScheduleFields}, though they write the same
 * rows — that editor is for someone tuning a schedule, this is asked of someone
 * who has not decided anything yet, and its whole value is that answering it is
 * nearly free. Labels are `actionDefOf(...).label` verbatim, the same offers the
 * schedule editor lists.
 *
 * Controlled, and hands back the **whole** set with `enabled` flipped rather
 * than just the ticks: rows existing is what makes "asked, and chose nothing"
 * distinguishable from "never asked".
 */
export function ReminderPromptFields({
  value,
  onChange,
}: {
  value: readonly ReminderRuleInput[];
  onChange: (next: ReminderRuleInput[]) => void;
}) {
  const toggle = (index: number, enabled: boolean) =>
    onChange(
      value.map((rule, i) => (i === index ? { ...rule, enabled } : rule)),
    );

  return (
    <View>
      {value.map((rule, i) => {
        const def = actionDefOf(rule.action);
        return (
          // Positional, like the schedule editor: no stable id until saved.
          <Pressable
            key={i}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: rule.enabled }}
            accessibilityLabel={def.label}
            onPress={() => toggle(i, !rule.enabled)}
            style={[styles.row, styles.rowWithLead]}
          >
            <Switch
              value={rule.enabled}
              onValueChange={(next) => toggle(i, next)}
            />
            <Text style={[styles.rowBody, styles.rowText]}>
              {def.icon ? `${def.icon} ` : ""}
              {def.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
