import {
  Pressable,
  Text,
  type AccessibilityState,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { styles } from "../lib/styles";

export type ButtonTone = "primary" | "secondary" | "destructive";

/** A tone's box, block-sized: shared with {@link LinkButton}. */
export const BUTTON_BOX: Record<ButtonTone, StyleProp<ViewStyle>> = {
  primary: [styles.button, styles.buttonBlock],
  secondary: [styles.buttonSecondary, styles.buttonBlock],
  destructive: [styles.button, styles.buttonDestructive, styles.buttonBlock],
};

export const BUTTON_LABEL: Record<ButtonTone, StyleProp<TextStyle>> = {
  primary: styles.buttonText,
  secondary: styles.buttonSecondaryText,
  destructive: styles.buttonText,
};

/** How far a not-ready or busy button fades; it is never disabled. */
const FADED_OPACITY = 0.4;

/**
 * A button that acts. `faded` only looks not-ready, so a press can say why;
 * `busy` also fades, and swallows presses until the work is done.
 */
export function Button({
  label,
  onPress,
  tone = "primary",
  busy = false,
  faded = false,
  style,
  testID,
  accessibilityLabel,
  accessibilityState,
}: {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  busy?: boolean;
  faded?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, busy }}
      testID={testID}
      style={[
        BUTTON_BOX[tone],
        (busy || faded) && { opacity: FADED_OPACITY },
        style,
      ]}
      onPress={() => {
        if (!busy) onPress();
      }}
    >
      <Text style={BUTTON_LABEL[tone]}>{label}</Text>
    </Pressable>
  );
}
