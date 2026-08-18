import { useCallback } from "react";
import { Animated } from "react-native";
import { useFocusEffect } from "expo-router";

/** How far the list travels while the title shrinks, in points. */
export const COLLAPSE_DISTANCE = 48;

/**
 * How far the focused screen has scrolled, which is what
 * `components/AppHeader.tsx` shrinks its title against.
 *
 * **One value for the whole app, deliberately.** The header is drawn by the
 * navigator rather than by the screen, so it sits outside the component tree
 * that owns the scroll position and cannot be handed one as a prop. A single
 * module-level value is sound because only one screen is focused at a time and
 * the header on screen is that screen's: there is never a second reader to
 * confuse. {@link useHeaderScroll} zeroes it on both focus and blur, so a screen
 * that does not opt in always draws its title at full size rather than
 * inheriting wherever the last scrolling screen stopped.
 */
export const headerScroll = new Animated.Value(0);

/**
 * Opt a screen's list into the collapsing title: spread the result onto the
 * `FlatList` or `ScrollView` that fills it.
 *
 * ```tsx
 * <FlatList {...useHeaderScroll()} data={…} />
 * ```
 *
 * A screen with nothing to scroll simply doesn't call this, and keeps its title
 * at full size — which is the honest rendering, since there is no scrolling for
 * it to respond to.
 */
export function useHeaderScroll() {
  useFocusEffect(
    useCallback(() => {
      headerScroll.setValue(0);
      return () => headerScroll.setValue(0);
    }, []),
  );

  return {
    // `useNativeDriver: false` is forced by what the header animates: a font size
    // and a container height are layout properties, and the native driver only
    // handles transforms and opacity. Fading two stacked titles would drive
    // natively, but then the header could not actually shrink — and shrinking is
    // the whole behavior.
    onScroll: Animated.event(
      [{ nativeEvent: { contentOffset: { y: headerScroll } } }],
      { useNativeDriver: false },
    ),
    scrollEventThrottle: 16,
  };
}
