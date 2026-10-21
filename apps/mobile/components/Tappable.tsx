import {
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { haptic } from "../lib/haptics";

/** How far a target dims under the finger, on top of any fade it has. */
const PRESSED_OPACITY = 0.7;

/**
 * A `Pressable` that dims while pressed, and ticks as a checkbox or radio.
 * `feedback={false}` keeps it still, for a target that is ignoring presses.
 */
export function Tappable({
  style,
  feedback = true,
  onPress,
  ...props
}: Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  feedback?: boolean;
}) {
  const ticks =
    feedback &&
    onPress != null &&
    (props.accessibilityRole === "checkbox" ||
      props.accessibilityRole === "radio");
  return (
    <Pressable
      {...props}
      onPress={
        ticks
          ? (event) => {
              haptic.ticked();
              onPress(event);
            }
          : onPress
      }
      style={({ pressed }) =>
        pressed && feedback
          ? [style, { opacity: restingOpacity(style) * PRESSED_OPACITY }]
          : style
      }
    />
  );
}

function restingOpacity(style: StyleProp<ViewStyle>): number {
  const opacity = StyleSheet.flatten(style)?.opacity;
  return typeof opacity === "number" ? opacity : 1;
}
