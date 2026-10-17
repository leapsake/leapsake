import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { HolidayPrompt, PromptCandidate } from "@leapsake/core";
import {
  type OfferContext,
  type ReminderRuleInput,
  withSomethingElse,
} from "@leapsake/schema";
import { useMessages } from "@leapsake/ui/messages";
import { Button } from "./Button";
import { CheckboxBox } from "./Checkbox";
import { ReminderPromptFields } from "./ReminderPromptFields";
import { Typeahead } from "./Typeahead";
import { showFormProblem } from "../lib/form-problem";
import { styles } from "../lib/styles";

/** The key a bearer is told apart by on the wish line. */
const keyOf = (b: { bearerType: string; bearerId: string }) =>
  `${b.bearerType}:${b.bearerId}`;

/** What the errand labels are worded against: errands are all your own. */
const OWN_ERRANDS: OfferContext = {
  greeting: "",
  forSelf: true,
  partner: null,
  recipients: {},
};

/**
 * A holiday's question: a tick per errand, and one for wishing people, ticked
 * while anyone under it is. Ticking it opens who and a search for more.
 */
export function HolidayPromptForm({
  prompt,
  onSave,
}: {
  prompt: HolidayPrompt;
  onSave: (
    answer: {
      errands: ReminderRuleInput[];
      wishes: HolidayPrompt["wishes"];
    },
    you: string | undefined,
  ) => void;
}) {
  const m = useMessages();
  const [errands, setErrands] = useState(prompt.errands);
  const [somethingElse, setSomethingElse] = useState("");
  const [wishes, setWishes] = useState(prompt.wishes);
  const [open, setOpen] = useState(() => prompt.wishes.some((w) => w.wish));
  const [shown, setShown] = useState(
    () => new Set(prompt.wishes.filter((w) => w.wish).map(keyOf)),
  );
  const [you, setYou] = useState<PromptCandidate | null>(null);

  const people = [...prompt.wishes, ...prompt.addable].filter(
    (p) => p.bearerType === "person",
  );
  const findable = [...prompt.wishes, ...prompt.addable];
  const offersWishes = prompt.wishes.length + prompt.addable.length > 0;
  const anyWished = wishes.some((w) => w.wish);
  const wishLine = m.holidayPrompt.wishLine(prompt.greeting);

  function wish(c: PromptCandidate) {
    const key = keyOf(c);
    setShown(new Set(shown).add(key));
    setWishes(
      wishes.some((w) => keyOf(w) === key)
        ? wishes.map((w) => (keyOf(w) === key ? { ...w, wish: true } : w))
        : [...wishes, { ...c, wish: true }],
    );
  }

  /** Unticking wishes nobody; ticking re-ticks whoever is listed. */
  function toggleWishing() {
    setOpen(!anyWished);
    setWishes(
      wishes.map((w) => (shown.has(keyOf(w)) ? { ...w, wish: !anyWished } : w)),
    );
  }

  function save() {
    const answered = withSomethingElse(errands, somethingElse);
    if (
      prompt.selfId === null &&
      you === null &&
      answered.some((e) => e.enabled)
    )
      return showFormProblem(m.holidayPrompt.youFirst);
    onSave({ errands: answered, wishes }, you?.bearerId);
  }

  const wishBlock = offersWishes && (
    <>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: anyWished }}
        accessibilityLabel={wishLine}
        onPress={toggleWishing}
        style={[styles.row, styles.rowWithLead]}
      >
        <CheckboxBox checked={anyWished} />
        <Text style={[styles.rowText, styles.rowBody]}>{wishLine}</Text>
      </Pressable>
      {open && (
        <View style={local.people}>
          {wishes
            .filter((w) => shown.has(keyOf(w)))
            .map((w) => (
              <Pressable
                key={keyOf(w)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: w.wish }}
                accessibilityLabel={w.label}
                onPress={() =>
                  setWishes(
                    wishes.map((x) =>
                      keyOf(x) === keyOf(w) ? { ...x, wish: !x.wish } : x,
                    ),
                  )
                }
                style={[styles.row, styles.rowWithLead]}
              >
                <CheckboxBox checked={w.wish} />
                <Text style={styles.rowText}>{w.label}</Text>
              </Pressable>
            ))}
          <Typeahead
            multi
            label={m.holidayPrompt.addSomeone}
            value={null}
            options={findable}
            exclude={shown}
            onChange={(c) => c !== null && wish(c)}
            getKey={keyOf}
            getLabel={(c) => c.label}
          />
        </View>
      )}
    </>
  );

  return (
    <View style={styles.promptForm}>
      {prompt.errands.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{m.holidayPrompt.forYou}</Text>
          {prompt.selfId === null && (
            <Typeahead
              label={m.holidayPrompt.whichIsYou}
              value={you}
              options={people}
              onChange={setYou}
              getKey={keyOf}
              getLabel={(p) => p.label}
              clearable
            />
          )}
          <ReminderPromptFields
            value={errands}
            offer={OWN_ERRANDS}
            onChange={setErrands}
            somethingElse={somethingElse}
            onSomethingElseChange={setSomethingElse}
          >
            {wishBlock}
          </ReminderPromptFields>
        </View>
      ) : (
        offersWishes && <View style={styles.section}>{wishBlock}</View>
      )}
      {prompt.errands.length === 0 && !offersWishes && (
        <Text style={styles.muted}>{m.holidayPrompt.nothingLeft}</Text>
      )}
      <Button label={m.holidayPrompt.save} onPress={save} />
    </View>
  );
}

const local = StyleSheet.create({
  people: { marginLeft: 36 },
});
