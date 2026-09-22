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

/** The delivery question's two answers. `mail` is the one that schedules
 *  anything; `hand` is the absence of a posting errand, said out loud rather
 *  than left to be inferred from an unticked box. */
const DELIVERY = [
  { value: "hand", label: "In person" },
  { value: "mail", label: "By mail" },
] as const;

/**
 * The prompt's answer form (mobile twin of the web `ReminderPromptFields`): one
 * checkbox per thing you might do, each wearing its lead time, and — under them,
 * only once something it could deliver is on — a single *in person or by mail?*
 * for the whole occasion.
 *
 * Deliberately not {@link ReminderScheduleFields}, though they write the same
 * rows. That editor is for someone tuning a schedule and lists every rule flat,
 * posting included; this is asked of someone who has not decided anything yet,
 * and its whole value is that answering it is nearly free. Which is also why the
 * delivery is **one** question rather than one under the gift and another under
 * the card: nobody has two answers to it. The rules underneath stay independent
 * and the flat editor can still split them.
 *
 * The lead time is read from the rule's own `offsetDays` and rendered as its own
 * line rather than spliced into the label, because that line is where an
 * *editable* lead time will go.
 *
 * Controlled, and hands back the **whole** set with `enabled` flipped rather
 * than just the ticks: rows existing is what makes "asked, and chose nothing"
 * distinguishable from "never asked". Every edit goes through
 * {@link setPromptItem} / {@link setPromptDelivery}, so the rule that a posting
 * cannot outlive the thing it posts lives in the model, once, for both clients.
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
              {/* The lead time, muted and underneath: it is what the tick
                  actually buys — a reminder at a time — and the screen said
                  nothing about it until now. */}
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
          {/* Only when posting, and only when the deliveries it governs agree on
              a date — a caption that had to name two would be describing a
              distinction the single control does not offer. */}
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
  // Indented under the ticks it belongs to, and given room above: it is a
  // follow-up question, not a fifth thing to do.
  delivery: {
    marginTop: 12,
    marginLeft: 8,
    gap: 6,
  },
});
