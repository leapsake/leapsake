import {
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/** How far a target dims under the finger, on top of any fade it has. */
const PRESSED_OPACITY = 0.5;

/**
 * A `Pressable` that dims while pressed, so a tap shows it landed.
 * `feedback={false}` keeps it still, for a target that is ignoring presses.
 */
export function Tappable({
  style,
  feedback = true,
  ...props
}: Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  feedback?: boolean;
}) {
  return (
    <Pressable
      {...props}
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
