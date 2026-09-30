import { type ReactNode, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLLAPSE_DISTANCE, headerScroll } from "../lib/use-header-scroll";
import { colors } from "../lib/styles";
import logo from "../assets/logo.png";

const BACK_LABEL = "‹ Back";

/** The title's size at rest, and once the screen under it has been scrolled. */
const TITLE_SIZE = { full: 24, compact: 17 } as const;

/** ~1.1× {@link TITLE_SIZE}: a glyph at a font's size reads smaller. */
const LOGO_SIZE = { full: 26, compact: 19 } as const;

/**
 * The app's one header, on both navigators: one row, a title that shrinks on
 * scroll, Back only where the navigator grants it (the app's README).
 */
export interface AppHeaderProps {
  title: string;
  /** A leading action after Back, from `headerLeft`; unused today. */
  left?: ReactNode;
  /** The screen's actions, as one node already laid out. */
  right?: ReactNode;
  /** Supplied by the navigator iff there is somewhere to go back to. */
  onBack?: () => void;
  /** The app's mark before the title: Home only, whose title is the name. */
  showLogo?: boolean;
}

export function AppHeader({
  title,
  left,
  right,
  onBack,
  showLogo = false,
}: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  // With Back, both sides take the wider one's width, so the title centres.
  const [sides, setSides] = useState({ left: 0, right: 0 });
  const centred = onBack !== undefined;
  const sideWidth = Math.max(sides.left, sides.right);
  const fontSize = headerScroll.interpolate({
    inputRange: [0, COLLAPSE_DISTANCE],
    outputRange: [TITLE_SIZE.full, TITLE_SIZE.compact],
    extrapolate: "clamp",
  });
  // Shrinks with the title, so the pair stays one lockup.
  const logoSize = headerScroll.interpolate({
    inputRange: [0, COLLAPSE_DISTANCE],
    outputRange: [LOGO_SIZE.full, LOGO_SIZE.compact],
    extrapolate: "clamp",
  });
  return (
    <View
      style={[
        local.header,
        {
          paddingTop: insets.top + 8,
          paddingLeft: insets.left + 16,
          paddingRight: insets.right + 16,
        },
      ]}
    >
      <View style={local.row}>
        {(centred || left !== undefined) && (
          <View style={centred && [local.side, { width: sideWidth }]}>
            <View
              style={[local.group, centred && local.groupStart]}
              onLayout={(e) => {
                const left = e.nativeEvent.layout.width;
                setSides((prev) =>
                  prev.left === left ? prev : { ...prev, left },
                );
              }}
            >
              {onBack !== undefined && (
                <Pressable
                  accessibilityRole="button"
                  onPress={onBack}
                  hitSlop={8}
                >
                  <Text style={local.back}>{BACK_LABEL}</Text>
                </Pressable>
              )}
              {left}
            </View>
          </View>
        )}
        {/* An empty title renders no element at all. */}
        {title !== "" && (
          <View style={[local.titleRow, centred && local.titleCentred]}>
            {showLogo && (
              /* Decorative: the title beside it already says the name. */
              <Animated.Image
                source={logo}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                resizeMode="contain"
                style={{ width: logoSize, height: logoSize }}
              />
            )}
            <Animated.Text
              accessibilityRole="header"
              numberOfLines={2}
              style={[
                local.title,
                centred && local.titleTextCentred,
                { fontSize },
              ]}
            >
              {title}
            </Animated.Text>
          </View>
        )}
        {/* Always drawn, so the actions sit at the trailing edge. */}
        {!centred && <View style={local.spacer} />}
        {(centred || right !== undefined) && (
          <View style={centred && [local.side, { width: sideWidth }]}>
            <View
              style={[local.group, centred && local.groupEnd]}
              onLayout={(e) => {
                const right = e.nativeEvent.layout.width;
                setSides((prev) =>
                  prev.right === right ? prev : { ...prev, right },
                );
              }}
            >
              {right}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  header: {
    backgroundColor: colors.surfaceRaised,
    paddingBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    // Holds the row open with no title and no actions.
    minHeight: 36,
    gap: 12,
  },
  /** Pushes `right` to the trailing edge whatever precedes it. */
  spacer: {
    flex: 1,
  },
  back: {
    fontSize: 16,
    color: colors.accent,
  },
  /** A fixed-width column. Its `group` is absolute, so it keeps its own
   *  width however narrow the column is, and can be measured. */
  side: {
    alignSelf: "stretch",
  },
  group: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  groupStart: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  groupEnd: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
  },
  titleCentred: {
    flex: 1,
    justifyContent: "center",
  },
  titleTextCentred: {
    textAlign: "center",
  },
  // `flexShrink`, so a long title wraps before it pushes the actions off.
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  title: {
    // `fontSize` is animated in.
    fontWeight: "700",
    color: colors.text,
    // Long titles wrap rather than push the row wider than the header.
    flexShrink: 1,
  },
});
