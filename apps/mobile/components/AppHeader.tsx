import type { ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLLAPSE_DISTANCE, headerScroll } from "../lib/use-header-scroll";
import { colors } from "../lib/styles";

const BACK_LABEL = "‹ Back";

/** The title's size at rest, and once the screen under it has been scrolled. */
const TITLE_SIZE = { full: 24, compact: 17 } as const;

/**
 * The app's one header, drawn by us on **both** navigators rather than by each
 * platform's own.
 *
 * It is mounted through react-navigation's `header` option — once on the root
 * stack (`app/_layout.tsx`) and once on the tab navigator
 * (`app/(tabs)/_layout.tsx`) — so every screen that already declares
 * `<Stack.Screen options={{ title, headerRight }} />` keeps working untouched
 * and gets identical chrome on iOS and Android. That was the point: the app is
 * moving away from "the iOS way here, the Android way there" toward one mobile
 * design, and a native header is the one piece of chrome that cannot be made to
 * agree across the two.
 *
 * The shape is a **title, not a bar**: a thin row of actions, and under it the
 * screen's name at reading size. There is no persistent top navigation.
 *
 * ### The title shrinks; it never leaves
 *
 * Scrolling the screen under it takes the title down to a compact size and stops
 * there, rather than sliding it away. A header that disappears buys back a line
 * of content at the cost of the reader's answer to "where am I?" — and on a
 * screen reached by tapping something two screens ago, that answer is worth more
 * than the line. The scroll position arrives through
 * {@link headerScroll}, which a screen opts into with `useHeaderScroll()`; a
 * screen with nothing to scroll never collapses.
 *
 * ### Back is the navigator's decision, not a screen's
 *
 * {@link AppHeaderProps.onBack} is supplied only where react-navigation says a
 * back destination exists — the native-stack header renderer receives a `back`
 * prop that is `undefined` at the root of a stack, and the tab header renderer
 * has no such prop at all. So anything hosted in the tab navigator
 * *structurally* cannot show a back control — the four tabs, and the four
 * catalogs that sit in there without a button — and every pushed screen
 * *structurally* does. No screen opts in, and none can get it wrong.
 *
 * ### The top inset must come from the context
 *
 * `useSafeAreaInsets()`, never a hardcoded status-bar height: when custody is
 * Degraded, `DegradedFrame` (`lib/core-context.tsx`) overrides the inset context
 * to `top: 0` because the custody banner above the navigator has already
 * consumed the notch. A hardcoded inset would silently reintroduce the dead band
 * that override exists to remove.
 */
export interface AppHeaderProps {
  title: string;
  /**
   * The screen's leading action, drawn immediately after Back — a **way into**
   * the screen's other mode rather than a way out of the screen. A record's
   * **Edit** is the one that asked for this slot: it opens the form over
   * everything the page shows, so it belongs beside the record's name and not
   * across from it, where Save lives on the form it opens.
   */
  left?: ReactNode;
  /** The screen's trailing action — its Save, or Search-here. */
  right?: ReactNode;
  /** Supplied by the navigator iff there is somewhere to go back to. */
  onBack?: () => void;
}

export function AppHeader({ title, left, right, onBack }: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const fontSize = headerScroll.interpolate({
    inputRange: [0, COLLAPSE_DISTANCE],
    outputRange: [TITLE_SIZE.full, TITLE_SIZE.compact],
    extrapolate: "clamp",
  });
  return (
    <View
      style={[
        local.header,
        {
          paddingTop: insets.top,
          paddingLeft: insets.left + 16,
          paddingRight: insets.right + 16,
        },
      ]}
    >
      {/* Always drawn, even when it holds nothing, so the title sits at the same
          height on every screen. A row that collapsed when a screen had no
          actions would make the title jump as you moved between tabs. */}
      <View style={local.actions}>
        {onBack !== undefined && (
          <Pressable accessibilityRole="button" onPress={onBack} hitSlop={8}>
            <Text style={local.back}>{BACK_LABEL}</Text>
          </Pressable>
        )}
        {left}
        <View style={local.spacer} />
        {right}
      </View>
      {/* An empty title renders nothing rather than an empty line. A screen whose
          own first words are its heading — the reminder detail — sets `title: ""`
          deliberately, and a blank band there would be the title bar saying the
          same sentence twice, in whitespace. */}
      {title !== "" && (
        <Animated.Text
          accessibilityRole="header"
          numberOfLines={2}
          style={[local.title, { fontSize }]}
        >
          {title}
        </Animated.Text>
      )}
    </View>
  );
}

const local = StyleSheet.create({
  header: {
    backgroundColor: colors.surfaceRaised,
    paddingBottom: 12,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    // Only ever seen between Back and a leading action; the spacer keeps the
    // trailing one at the edge either way.
    gap: 16,
  },
  /** Pushes `right` to the trailing edge whether or not there is a back control. */
  spacer: {
    flex: 1,
  },
  back: {
    fontSize: 16,
    color: colors.accent,
  },
  title: {
    // `fontSize` is animated in, so it is deliberately absent here.
    fontWeight: "700",
    color: colors.text,
  },
});
