import { useState } from "react";
import {
  Pressable,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { styles } from "../lib/styles";

const SHOW = "Show";
const HIDE = "Hide";
const SHOW_LABEL = "Show password";
const HIDE_LABEL = "Hide password";

/**
 * A masked text field with a Show/Hide toggle beside it. `style` is the box: the
 * row wears it, and the input takes it back minus the border, background and padding.
 */
export function PasswordInput({ style, ...rest }: TextInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={[style, styles.passwordRow]}>
      <TextInput
        style={[style, styles.passwordRowInput]}
        autoCapitalize="none"
        autoCorrect={false}
        {...rest}
        secureTextEntry={!visible}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={visible ? HIDE_LABEL : SHOW_LABEL}
        hitSlop={8}
        onPress={() => setVisible((v) => !v)}
      >
        <Text style={styles.passwordToggle}>{visible ? HIDE : SHOW}</Text>
      </Pressable>
    </View>
  );
}
