import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
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
import { Sheet } from "./Sheet";
import { Typeahead } from "./Typeahead";
import { showFormProblem } from "../lib/form-problem";
import { colors, fonts, styles } from "../lib/styles";

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
 * while anyone is. Its row opens a sheet of who, with a search for more.
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
  const { height } = useWindowDimensions();
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

  /** Unticking wishes nobody; ticking re-ticks whoever is listed, or opens
   *  the sheet to find someone when nobody is. */
  function toggleWishing() {
    if (!anyWished && shown.size === 0) return setOpen(true);
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

  const listed = wishes.filter((w) => shown.has(keyOf(w)));
  const wishBlock = offersWishes && (
    <View style={[styles.row, styles.rowWithLead]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: anyWished }}
        accessibilityLabel={wishLine}
        onPress={toggleWishing}
        hitSlop={8}
      >
        <CheckboxBox checked={anyWished} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={[styles.rowBody, local.opener]}
      >
        <View style={styles.rowBody}>
          <Text style={styles.rowText}>{wishLine}</Text>
          <Text style={local.who}>
            {m.holidayPrompt.wishing(
              wishes.filter((w) => w.wish).map((w) => w.label),
            )}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        close="done"
        title={wishLine}
        style={{ height: height * 0.85 }}
      >
        <View style={local.body}>
          <Typeahead
            multi
            label={m.holidayPrompt.addSomeone}
            value={null}
            options={findable}
            exclude={shown}
            onChange={(c) => c !== null && wish(c)}
            getKey={keyOf}
            getLabel={(c) => c.label}
            renderOption={(c) => (
              <View style={styles.rowWithLead}>
                <CheckboxBox checked={false} />
                <Text style={styles.rowText}>{c.label}</Text>
              </View>
            )}
          />
        </View>
        <ScrollView
          style={local.list}
          contentContainerStyle={local.body}
          keyboardShouldPersistTaps="handled"
        >
          {listed.map((w) => (
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
        </ScrollView>
      </Sheet>
    </View>
  );

  return (
    <View style={styles.promptForm}>
      {(prompt.errands.length > 0 || offersWishes) && (
        <Text style={styles.promptCaption}>{m.holidayPrompt.caption}</Text>
      )}
      {prompt.errands.length > 0 ? (
        <View style={styles.section}>
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
      <Button label={m.holidayPrompt.done} onPress={save} />
    </View>
  );
}

const local = StyleSheet.create({
  opener: { flexDirection: "row", alignItems: "center", gap: 8 },
  who: { fontFamily: fonts.serif, fontSize: 13, color: colors.muted },
  body: { paddingHorizontal: 16, paddingTop: 12 },
  /** Takes what the bar and the search leave, which is what scrolls. */
  list: { flex: 1 },
});
