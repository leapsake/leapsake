import { StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { styles } from "../lib/styles";

const GLYPH = { add: "➕", edit: "⋯" } as const;
const LABEL = {
  add: (what: string) => `Add ${what}`,
  edit: (what: string) => `Edit ${what}`,
} as const;

/**
 * A section header's ➕ (add) or ⋯ (edit), opening `href` or running `onPress`.
 * A screen reader hears the whole phrase instead: "Add gift", "Edit tags".
 */
export function SectionLink({
  what,
  action = "edit",
  ...target
}: {
  what: string;
  action?: "add" | "edit";
} & ({ href: string } | { onPress: () => void })) {
  const router = useRouter();
  return (
    <Text
      accessibilityRole="button"
      accessibilityLabel={LABEL[action](what)}
      onPress={() =>
        "href" in target ? router.push(target.href) : target.onPress()
      }
      style={action === "add" ? local.add : [styles.link, local.edit]}
    >
      {GLYPH[action]}
    </Text>
  );
}

// Centred in the same width as a row's ⋯, so the column lines up.
const local = StyleSheet.create({
  add: {
    fontSize: 17,
    minWidth: 32,
    paddingVertical: 4,
    textAlign: "center",
  },
  edit: {
    minWidth: 32,
    paddingVertical: 4,
    textAlign: "center",
  },
});
