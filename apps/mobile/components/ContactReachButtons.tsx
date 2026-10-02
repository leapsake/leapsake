import { StyleSheet, Text, View } from "react-native";
import type { ContactMethod } from "@leapsake/schema";
import { actionLabel, offeredActions } from "../lib/contact-actions";
import { resolveActions } from "@leapsake/contact-links";
import { useContactReach } from "../lib/use-contact-reach";
import { styles } from "../lib/styles";
import { Button } from "./Button";

/**
 * The ways to reach someone, on the reminder that asks you to: the likeliest
 * action per method. ⚠️ Renders nothing with none; a CTA asks for one.
 */
export function ContactReachButtons({
  methods,
  subjectName,
  named = false,
}: {
  /** The person's reachable methods — postal already excluded by core. */
  methods: readonly ContactMethod[];
  /** Who the reminder is about, for the call confirmation. */
  subjectName: string;
  /** Whether to head the strip with their name, when a reminder has several. */
  named?: boolean;
}) {
  const { schemes, region, perform } = useContactReach(subjectName);
  const offers = methods
    .map((entry) => ({
      entry,
      action: offeredActions(resolveActions(entry, { region }), schemes)[0],
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

  const strip = (
    <View style={local.strip}>
      {offers.map(({ entry, action }) => (
        <Button
          key={entry.method.id}
          label={`${actionLabel(action)} · ${entry.method.label}`}
          tone="secondary"
          accessibilityLabel={`${actionLabel(action)} — ${entry.method.label}`}
          onPress={() => perform(action, entry)}
        />
      ))}
    </View>
  );
  if (!named) return strip;
  return (
    <View style={local.named}>
      <Text style={styles.fieldLabel}>{subjectName}</Text>
      {strip}
    </View>
  );
}

const local = StyleSheet.create({
  named: { marginTop: 8 },
  /** Wraps rather than scrolls, so no way to reach someone is hidden. */
  strip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
  },
});
