import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  type ReminderRuleInput,
  actionDefOf,
  leadTimeLabel,
  offerLabel,
  promptGroupsOf,
  setPromptDelivery,
  setPromptItem,
} from "@leapsake/schema";
import { CheckboxBox } from "./Checkbox";
import { SegmentedControl } from "./SegmentedControl";
import { colors, styles } from "../lib/styles";

/** The delivery question's answers: only `mail` schedules a posting errand. */
const DELIVERY = [
  { value: "hand", label: "In person" },
  { value: "mail", label: "By mail" },
] as const;

/**
 * The prompt's answer: a tick per thing to do, then one delivery question for
 * the occasion. Hands back the whole set, so "chose nothing" is recorded.
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
  const { items, delivery } = promptGroupsOf(value);

  return (
    <View>
      {items.map(({ index, rule }) => {
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

      {delivery?.visible === true && (
        <View style={local.delivery}>
          <Text style={styles.fieldLabel}>Giving it</Text>
          <SegmentedControl
            options={DELIVERY}
            value={delivery.mailed ? "mail" : "hand"}
            onChange={(next) =>
              onChange(setPromptDelivery(value, next === "mail"))
            }
            testID="prompt-delivery"
          />
          {/* Only when the deliveries it governs agree on a date. */}
          {delivery.mailed && delivery.offsetDays !== null && (
            <Text style={local.lead}>
              We’ll remind you to post it {leadTimeLabel(delivery.offsetDays)}.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const local = StyleSheet.create({
  lead: {
    fontSize: 13,
    color: colors.muted,
  },
  // Indented: a follow-up question, not a fifth thing to do.
  delivery: {
    marginTop: 12,
    marginLeft: 8,
    gap: 6,
  },
});
