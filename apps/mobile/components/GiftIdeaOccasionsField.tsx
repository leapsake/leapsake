import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type GiftOccasionChoice,
  type IdeaOccasionRow,
  newIdeaOccasionRow,
} from "@leapsake/ui/headless";
import { GiftOccasionFields } from "./GiftOccasionFields";
import { useCore } from "../lib/core-context";
import { styles } from "../lib/styles";

/**
 * What the **idea** is for, with nobody named — "this would make a good
 * Christmas gift for someone", "this is a great idea for someone's birthday".
 *
 * The one gift adornment that needs no recipient, so it sits on the idea rather
 * than under a person: on the capture form when no recipient has been picked,
 * and on the idea's own edit screen, which is where it lives afterwards.
 *
 * A repeatable list, unlike a suggestion's single "For…", because an idea really
 * does suit several occasions — a candle is a birthday gift *and* a
 * housewarming gift — and each row is stored as its own row.
 *
 * The pool comes from `gifts.generalOccasions`: every holiday, plus the milestone
 * *kinds* ("Birthday"), since with no recipient there is no milestone to point
 * at. Nothing here creates anything — a kind is what an idea stores. It is only
 * once the idea is suggested for a real person that core turns "someone's
 * birthday" into theirs.
 */
export function GiftIdeaOccasionsField({
  rows,
  onChange,
  label = "Good for…",
}: {
  rows: IdeaOccasionRow[];
  onChange: (rows: IdeaOccasionRow[]) => void;
  /** Overridden on the idea's own screen, where it is a titled section. */
  label?: string;
}) {
  const core = useCore();
  const [occasions, setOccasions] = useState<GiftOccasionChoice[]>([]);
  // The pool is the same for every row and never changes while the form is open
  // (it is the holiday catalog plus a static kind list), so it is fetched once
  // here rather than per row.
  useEffect(() => {
    let active = true;
    void core.gifts
      .generalOccasions()
      .then((list) => active && setOccasions(list));
    return () => {
      active = false;
    };
  }, [core]);

  const update = (id: string, patch: Partial<IdeaOccasionRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <View style={styles.section}>
      {rows.map((row) => (
        <View key={row.id} style={styles.section}>
          <GiftOccasionFields
            // An idea's occasion is a target, like a suggestion's: what it would
            // be good *for*, never a thing that has happened.
            kind="suggestion"
            label={label}
            occasions={occasions}
            occasion={row.occasion}
            onOccasionChange={(occasion) => update(row.id, { occasion })}
            date={row.date}
            onDateChange={(date) => update(row.id, { date })}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => onChange(rows.filter((r) => r.id !== row.id))}
          >
            <Text style={[styles.link, styles.danger]}>Remove occasion</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        testID="add-idea-occasion"
        onPress={() => onChange([...rows, newIdeaOccasionRow()])}
      >
        <Text style={styles.link}>
          {rows.length === 0 ? "+ What is this for?" : "+ Add another occasion"}
        </Text>
      </Pressable>
    </View>
  );
}
