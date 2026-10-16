import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  type OfferContext,
  type ReminderRuleInput,
  actionDefOf,
  leadTimeLabel,
  promptItemLabel,
  promptItemsOf,
  setPromptItem,
} from "@leapsake/schema";
import { CheckboxBox } from "./Checkbox";
import { colors, fonts, styles } from "../lib/styles";

const SOMETHING_ELSE = "Something else…";

/**
 * The prompt's answer: a tick per thing to do, and a field for an errand of
 * the user's own. Hands back the whole set, so "chose nothing" is recorded.
 */
export function ReminderPromptFields({
  value,
  offer,
  onChange,
  somethingElse,
  onSomethingElseChange,
}: {
  value: readonly ReminderRuleInput[];
  /** The occasion and whose it is, which the labels may name. */
  offer: OfferContext;
  onChange: (next: ReminderRuleInput[]) => void;
  /** What is typed into _Something else…_. */
  somethingElse: string;
  onSomethingElseChange: (text: string) => void;
}) {
  return (
    <View>
      {promptItemsOf(value).map(({ index, rule }) => {
        const def = actionDefOf(rule.action);
        const label = promptItemLabel(rule, offer);
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
      <TextInput
        accessibilityLabel={SOMETHING_ELSE}
        placeholder={SOMETHING_ELSE}
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={somethingElse}
        onChangeText={onSomethingElseChange}
      />
    </View>
  );
}

const local = StyleSheet.create({
  lead: {
    fontFamily: fonts.serif,
    fontSize: 13,
    color: colors.muted,
  },
});
