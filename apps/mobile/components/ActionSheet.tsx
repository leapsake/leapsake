import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, styles } from "../lib/styles";

const CANCEL = "Cancel";

/** One option in the sheet. */
export interface SheetItem {
  key: string;
  glyph?: string;
  label: string;
  /** A muted trailing note: "profile" where a link opens no conversation. */
  hint?: string;
  danger?: boolean;
  onPress: () => void;
}

/** A row's actions as a bottom sheet of full-width options, then Cancel. */
export function ActionSheet({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  /** What the sheet is about, e.g. the row's label. */
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
      <View style={local.sheet} testID="action-sheet">
        <Text style={local.title} numberOfLines={2}>
          {title}
        </Text>
        {items.map((item) => (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityHint={item.hint}
            testID={`action-sheet-${item.key}`}
            style={local.option}
            onPress={() => {
              // Close first: a pushed screen would arrive behind the modal.
              onClose();
              item.onPress();
            }}
          >
            {item.glyph === undefined ? null : (
              <Text style={local.glyph}>{item.glyph}</Text>
            )}
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
  /** At the trailing edge, a qualifier rather than a second label. */
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
