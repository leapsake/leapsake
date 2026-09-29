import { useCallback } from "react";
import { Animated } from "react-native";
import { useFocusEffect } from "expo-router";

/** How far the list travels while the title shrinks, in points. */
export const COLLAPSE_DISTANCE = 48;

/**
 * How far the focused screen has scrolled, for `AppHeader`'s title. One value
 * app-wide: only one screen is focused, and focus and blur zero it.
 */
export const headerScroll = new Animated.Value(0);

/** Opt a screen's list into the collapsing title: spread it onto the list. */
export function useHeaderScroll() {
  useFocusEffect(
    useCallback(() => {
      headerScroll.setValue(0);
      return () => headerScroll.setValue(0);
    }, []),
  );

  return {
    // The header animates a font size and a height, which the native driver
    // cannot: it handles only transforms and opacity.
    onScroll: Animated.event(
      [{ nativeEvent: { contentOffset: { y: headerScroll } } }],
      { useNativeDriver: false },
    ),
    scrollEventThrottle: 16,
  };
}
