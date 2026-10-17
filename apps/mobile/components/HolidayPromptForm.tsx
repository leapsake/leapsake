import { useState } from "react";
import { Pressable, Text, View } from "react-native";
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
 * A holiday's question: your errands, then everyone else on one wish line
 * that opens to a tick each and a field to add someone.
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
  const [open, setOpen] = useState(false);
  const [you, setYou] = useState<PromptCandidate | null>(null);

  const people = [...prompt.wishes, ...prompt.addable].filter(
    (p) => p.bearerType === "person",
  );
  const onLine = new Set(wishes.map(keyOf));
  const offersWishes = prompt.wishes.length + prompt.addable.length > 0;

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

  return (
    <View style={styles.promptForm}>
      {prompt.errands.length > 0 && (
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
          />
        </View>
      )}
      {offersWishes && (
        <View style={styles.section}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen(!open)}
            style={styles.row}
          >
            <Text style={styles.rowText}>
              {open ? "▾ " : "▸ "}
              {m.holidayPrompt.wishLine(prompt.greeting)}
            </Text>
          </Pressable>
          {open && (
            <>
              {wishes.map((w) => (
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
              {prompt.addable.length > 0 && (
                <Typeahead
                  multi
                  label={m.holidayPrompt.addSomeone}
                  value={null}
                  options={prompt.addable}
                  exclude={onLine}
                  onChange={(c) =>
                    c !== null && setWishes([...wishes, { ...c, wish: true }])
                  }
                  getKey={keyOf}
                  getLabel={(c) => c.label}
                />
              )}
            </>
          )}
        </View>
      )}
      {prompt.errands.length === 0 && !offersWishes && (
        <Text style={styles.muted}>{m.holidayPrompt.nothingLeft}</Text>
      )}
      <Button label={m.holidayPrompt.save} onPress={save} />
    </View>
  );
}
