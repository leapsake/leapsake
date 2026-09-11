import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ContactMethod } from "@leapsake/schema";
import { actionLabel, offeredActions } from "../lib/contact-actions";
import { resolveActions } from "@leapsake/contact-links";
import { useContactReach } from "../lib/use-contact-reach";
import { styles } from "../lib/styles";

/**
 * The ways to reach someone, on the reminder that asks you to.
 *
 * "Wish @Alice a happy birthday" says *what*; this says *how*, and is the whole
 * of what the channel-specific reminders used to be. Scheduling "call Alice" and
 * "text Alice" as separate errands asked, weeks ahead, a question only the
 * moment can answer — so the acknowledgment is one row, and the choice of
 * channel is these buttons, made when the reminder actually fires.
 *
 * One button per method, not per action: a phone that is also on WhatsApp offers
 * several things, and this is a strip on a reminder rather than the person's
 * Contact section, so it shows the **likeliest** thing per method and leaves the
 * rest to that screen. The label names the method, so two numbers read as "Text
 * — Mobile" and "Text — Work" rather than as the same button twice.
 *
 * ⚠️ It renders **nothing** when there is nothing to offer, rather than an empty
 * state: the collect prompt is a CTA the view-model decides on (`reminderCtaOf`,
 * the `contact` kind), so an empty strip here would be the second thing on
 * screen saying the same absence.
 */
export function ContactReachButtons({
  methods,
  subjectName,
}: {
  /** The person's reachable methods — postal already excluded by core. */
  methods: readonly ContactMethod[];
  /** Who the reminder is about, for the call confirmation. */
  subjectName: string;
}) {
  const { schemes, perform } = useContactReach(subjectName);
  const offers = methods
    .map((entry) => ({
      entry,
      action: offeredActions(resolveActions(entry), schemes)[0],
    }))
    .filter(
      (
        offer,
      ): offer is {
        entry: ContactMethod;
        action: NonNullable<typeof offer.action>;
      } => offer.action !== undefined,
    );

  if (offers.length === 0) return null;

  return (
    <View style={local.strip}>
      {offers.map(({ entry, action }) => (
        <Pressable
          key={entry.method.id}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel(action)} — ${entry.method.label}`}
          onPress={() => perform(action, entry)}
          style={[styles.buttonSecondary, local.button]}
        >
          <Text style={styles.buttonSecondaryText}>
            {actionLabel(action)} · {entry.method.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const local = StyleSheet.create({
  /** Wraps rather than scrolls: a dozen methods is rare, and a strip that runs
   *  off the edge hides the ways to reach someone behind a gesture. */
  strip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
  },
  /** The one place a reminder's buttons are **not** full-width: these are a set
   *  of like things (one per method) rather than a set of choices, their labels
   *  are short, and stacking six of them would push the reminder's actual offers
   *  off the screen. They keep the shared secondary box, so they still read as
   *  buttons — just as a strip of them. `minHeight` matches `buttonBlock`, since
   *  a smaller target is no easier to hit for being one of several. */
  button: {
    minHeight: 44,
    justifyContent: "center",
  },
});
