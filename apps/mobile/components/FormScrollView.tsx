import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  type ScrollViewProps,
} from "react-native";

/**
 * A scroller for a screen with text fields: the keyboard never covers the
 * focused field or what follows it, and a tap outside a field dismisses it.
 */
export function FormScrollView(props: ScrollViewProps) {
  const scroll = (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      {...props}
    />
  );
  if (Platform.OS === "ios") return scroll;
  // Edge-to-edge Android does not resize the window for the keyboard.
  return (
    <KeyboardAvoidingView style={local.fill} behavior="padding">
      {scroll}
    </KeyboardAvoidingView>
  );
}

const local = StyleSheet.create({
  fill: { flex: 1 },
});
