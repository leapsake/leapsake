import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, radius, styles } from "../lib/styles";

const TITLE = "What are you adding?";
const CANCEL = "Cancel";

/**
 * What the **New** tab offers when the screen underneath it hasn't already
 * answered the question. Three things a user creates from nothing:
 *
 * - **Person** — `/add`, which also covers pets behind its own toggle.
 * - **Reminder** — `/reminders/new`.
 * - **Gift idea** — `/gifts/new`.
 *
 * Deliberately **not** "Occasion", which the tab bar's brief asked for. There is
 * no such record: an occasion is a pointer at either a milestone or an observed
 * holiday. Holidays come from a seeded catalog, and a milestone needs a bearer
 * before it can exist — so "New occasion" from here would have to invent a
 * who-is-this-for step for a thing that is already one tap away on the person or
 * pet whose occasion it is. Milestones stay there.
 */
const OPTIONS = [
  { href: "/add", glyph: "🙂", label: "Person" },
  { href: "/reminders/new", glyph: "🔔", label: "Reminder" },
  { href: "/gifts/new", glyph: "🎁", label: "Gift idea" },
] as const;

/**
 * The chooser itself: full-width rows, large enough to hit without aiming, on a
 * sheet that a tap outside dismisses.
 *
 * It follows the sheet already in the app (`components/SelectField.tsx`) —
 * React Native's own `Modal`, a translucent backdrop that dismisses on press, a
 * panel resting on the bottom edge — rather than a sheet library, because that
 * is one component's worth of layout and the dependency would buy gestures
 * nothing here wants. Unlike that one it renders on **both** platforms: this is
 * the app's own chrome rather than a stand-in for a native picker.
 *
 * Reachable by an ordinary tap. There is no long-press anywhere in this flow —
 * a gesture with no visible affordance is a feature only its author can find.
 */
export function CreateSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={CANCEL}
        style={local.backdrop}
        onPress={onClose}
      />
      <View style={local.sheet} testID="create-sheet">
        <Text style={local.title}>{TITLE}</Text>
        {OPTIONS.map((option) => (
          <Pressable
            key={option.href}
            accessibilityRole="button"
            style={local.option}
            onPress={() => {
              // Close first: leaving the modal mounted over a push means the new
              // screen arrives behind it.
              onClose();
              router.push(option.href);
            }}
          >
            <Text style={local.glyph}>{option.glyph}</Text>
            <Text style={local.label}>{option.label}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          style={local.cancel}
          onPress={onClose}
        >
          <Text style={styles.link}>{CANCEL}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const local = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 8,
  },
  title: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 4,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    // Tall rows on purpose: this is a chooser reached by a thumb at the bottom
    // of the screen, so each option is a target rather than a line of text.
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  glyph: {
    fontSize: 22,
  },
  label: {
    fontSize: 17,
    fontWeight: "600",
    color: colors.text,
  },
  cancel: {
    alignItems: "center",
    paddingVertical: 12,
  },
});
