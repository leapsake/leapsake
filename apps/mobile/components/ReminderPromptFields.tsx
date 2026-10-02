import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  type ReminderRuleInput,
  actionDefOf,
  leadTimeLabel,
  offerLabel,
  promptItemsOf,
  setPromptItem,
} from "@leapsake/schema";
import { CheckboxBox } from "./Checkbox";
import { colors, styles } from "../lib/styles";

/**
 * The prompt's answer: a tick per thing to do. Hands back the whole set, so
 * "chose nothing" is recorded.
 */
export function ReminderPromptFields({
  value,
  greeting,
  onChange,
}: {
  value: readonly ReminderRuleInput[];
  /** The occasion's greeting, "a happy birthday", which the labels may name. */
  greeting: string;
  onChange: (next: ReminderRuleInput[]) => void;
}) {
  return (
    <View>
      {promptItemsOf(value).map(({ index, rule }) => {
        const def = actionDefOf(rule.action);
        const label = offerLabel(rule.action, greeting);
        return (
          <Pressable
            key={index}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: rule.enabled }}
            accessibilityLabel={label}
            accessibilityHint={leadTimeLabel(rule.offsetDays)}
            onPress={() => onChange(setPromptItem(value, index, !rule.enabled))}
            style={[styles.row, styles.rowWithLead]}
          >
            <CheckboxBox checked={rule.enabled} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText}>
                {def.icon ? `${def.icon} ` : ""}
                {label}
              </Text>
              {/* Its own line, where an editable lead time will go. */}
              <Text style={local.lead}>{leadTimeLabel(rule.offsetDays)}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const local = StyleSheet.create({
  lead: {
    fontSize: 13,
    color: colors.muted,
  },
});
