import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, styles } from "../lib/styles";

const CANCEL = "Cancel";

/** One row of the sheet: a way to reach someone, or a way to manage the row. */
export interface SheetItem {
  key: string;
  glyph: string;
  label: string;
  /** A muted trailing note — "profile" where a link doesn't open a conversation. */
  hint?: string;
  danger?: boolean;
  onPress: () => void;
}

/**
 * Everything a contact-method row can do, once the row itself has spent its one
 * tap on the likeliest of them.
 *
 * A row has several sensible actions — a number can be texted, called, or opened
 * in WhatsApp — but only one tap, so the rest need somewhere to live. This is
 * that somewhere, and it holds Edit and Remove too: those used to sit *in* the
 * row as links, which is what stopped the row body from being tappable at all.
 * Moving them here is what freed the tap.
 *
 * Built on the same `Modal` + backdrop + bottom panel as
 * {@link SelectField}'s picker, deliberately rather than by extracting a shared
 * sheet: two sheets is not yet a pattern, and the layout is small enough that a
 * premature abstraction would cost more than the duplication. There were three
 * for a while — the New tab's chooser was the other — and it went with the tab
 * rather than being generalised, which is the outcome the duplication was
 * betting on.
 */
export function ContactActionSheet({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  /** What the sheet is about — the method's label and value. */
  title: string;
  items: readonly SheetItem[];
  onClose: () => void;
}) {
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
      <View style={local.sheet} testID="contact-action-sheet">
        <Text style={local.title} numberOfLines={2}>
          {title}
        </Text>
        {items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            style={local.option}
            onPress={() => {
              // Close before acting: leaving the modal mounted while the OS
              // switches apps means it is still there on the way back, and a
              // pushed screen would arrive behind it.
              onClose();
              item.onPress();
            }}
          >
            <Text style={local.glyph}>{item.glyph}</Text>
            <Text
              style={[local.label, item.danger === true && local.dangerLabel]}
            >
              {item.label}
            </Text>
            {item.hint === undefined ? null : (
              <Text style={local.hint}>{item.hint}</Text>
            )}
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
    flexShrink: 1,
  },
  dangerLabel: {
    color: colors.danger,
  },
  /** Pushed to the trailing edge, where it reads as a qualifier not a second label. */
  hint: {
    marginLeft: "auto",
    fontSize: 13,
    color: colors.muted,
  },
  cancel: {
    alignItems: "center",
    paddingVertical: 12,
  },
});
