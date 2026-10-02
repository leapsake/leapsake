import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { styles } from "../lib/styles";

const CLOSE = { cancel: "Cancel", done: "Done" } as const;

/**
 * A bottom sheet over a dimmed backdrop; a tap on the backdrop closes it.
 * `close` adds the top bar, its `title` left and the way out right.
 */
export function Sheet({
  visible,
  onClose,
  close,
  title,
  avoidKeyboard = false,
  style,
  testID,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  close?: keyof typeof CLOSE;
  title?: string;
  /** Lifts the sheet over the keyboard, for one pinned to the bottom. */
  avoidKeyboard?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
}) {
  const content = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={CLOSE[close ?? "cancel"]}
        style={styles.sheetBackdrop}
        onPress={onClose}
      />
      <View style={[styles.sheet, style]} testID={testID}>
        {close !== undefined && (
          <View
            style={[styles.sheetBar, title === undefined && local.closeOnly]}
          >
            {title !== undefined && (
              <Text style={styles.sheetTitle}>{title}</Text>
            )}
            <Pressable accessibilityRole="button" onPress={onClose}>
              <Text style={styles.link}>{CLOSE[close]}</Text>
            </Pressable>
          </View>
        )}
        {children}
      </View>
    </>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {avoidKeyboard ? (
        <KeyboardAvoidingView
          style={local.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </Modal>
  );
}

const local = StyleSheet.create({
  fill: { flex: 1 },
  closeOnly: { justifyContent: "flex-end" },
});
