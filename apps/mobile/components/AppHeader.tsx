import type { ReactNode } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLLAPSE_DISTANCE, headerScroll } from "../lib/use-header-scroll";
import { colors } from "../lib/styles";
import logo from "../assets/logo.png";

const BACK_LABEL = "‹ Back";

/** The title's size at rest, and once the screen under it has been scrolled. */
const TITLE_SIZE = { full: 24, compact: 17 } as const;

/**
 * The mark's size beside the title, slightly larger than the text at both ends.
 *
 * A glyph set to the same number as a font size reads *smaller* than the letters next to
 * it, because a font's point size covers ascender to descender and the drawing fills its
 * whole box. These are ~1.1× {@link TITLE_SIZE}, which is what makes the two look like one
 * lockup rather than a small picture next to big words.
 */
const LOGO_SIZE = { full: 26, compact: 19 } as const;

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
 * ### One row: back, title, actions
 *
 * The actions sit **on the title's line**, not above it. They had their own row
 * for as long as the only thing in it was a lone link, and a lone link floating
 * over a heading reads as a stray — it belongs to the title, so it sits with it.
 *
 * The row survives the crowding it looks like it should cause, because the two
 * clusters that could fill it **never appear together**. Back reaches a screen
 * only through the native stack (see below), and the create/search actions are
 * declared only on screens inside the tab navigator, which structurally cannot
 * receive one. So a header is either `‹ Back · Title · Edit` or
 * `Title · 🔍 ➕`, and never both at once.
 *
 * The title is still a **title and not a bar**: it sits at reading size on the
 * leading edge rather than centred and shrunk to fit between two controls, which
 * is the part of the old shape that was worth keeping.
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
 * The actions keep their size through that collapse. They are controls rather
 * than typography, and a control that shrinks as you scroll is a control that
 * gets harder to hit the further you read.
 *
 * ### Back is the navigator's decision, not a screen's
 *
 * {@link AppHeaderProps.onBack} is supplied only where react-navigation says a
 * back destination exists — the native-stack header renderer receives a `back`
 * prop that is `undefined` at the root of a stack, and the tab header renderer
 * has no such prop at all. So anything hosted in the tab navigator
 * *structurally* cannot show a back control — the four tabs, and the three
 * catalogs that sit in there without a button — and every pushed screen
 * *structurally* does. No screen opts in, and none can get it wrong.
 *
 * That is also what makes the single row above safe rather than lucky: it is not
 * that back and a create action happen not to co-occur today, it is that the
 * navigator that grants one cannot grant the other.
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
   * The screen's leading action, drawn immediately after Back. Nothing claims
   * this slot today — a record's **Edit** used to, and moved across to {@link
   * AppHeaderProps.right} so that every screen's action sits in one corner — but
   * it stays wired because it is react-navigation's own `headerLeft`, and a
   * screen that ever needs a second action shouldn't have to add the plumbing.
   */
  left?: ReactNode;
  /**
   * The screen's action, or actions — its Edit, its Save, or the 🔍 and ➕ a
   * catalog carries. More than one arrives as a single node already laid out
   * (`styles.headerActions`), so this slot never has to know how many there are.
   */
  right?: ReactNode;
  /** Supplied by the navigator iff there is somewhere to go back to. */
  onBack?: () => void;
  /**
   * Draw the app's mark before the title. Home only, and set by the tab navigator rather
   * than by the screen — see `app/(tabs)/_layout.tsx`.
   *
   * This is the one header whose title is the *product's* name rather than a description
   * of where you are, and the mark belongs to that name. On every other screen the title
   * answers “where am I?”, and a logo repeated above each answer would be branding a
   * breadcrumb.
   */
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
  const fontSize = headerScroll.interpolate({
    inputRange: [0, COLLAPSE_DISTANCE],
    outputRange: [TITLE_SIZE.full, TITLE_SIZE.compact],
    extrapolate: "clamp",
  });
  // Shrinks on the same scroll as the title, so the pair stays a lockup instead of the
  // mark hanging at full size beside text that has moved on without it.
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
        {onBack !== undefined && (
          <Pressable accessibilityRole="button" onPress={onBack} hitSlop={8}>
            <Text style={local.back}>{BACK_LABEL}</Text>
          </Pressable>
        )}
        {left}
        {/* An empty title renders nothing rather than an empty word. A screen whose
            own first words are its heading — the reminder detail — sets `title: ""`
            deliberately, and a blank run there would be the title bar saying the
            same sentence twice, in whitespace. The spacer below still holds the
            actions at the trailing edge without it. */}
        {title !== "" && (
          <View style={local.titleRow}>
            {showLogo && (
              /*
                Decorative, and deliberately left out of the accessibility tree: the word
                beside it says the same thing and already carries the `header` role. A screen
                reader that announced “Leapsake” twice would be describing the layout rather
                than the app.
              */
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
              style={[local.title, { fontSize }]}
            >
              {title}
            </Animated.Text>
          </View>
        )}
        {/* Always drawn, so the actions sit at the trailing edge whether the row
            holds a title, a back control, both, or neither — and so a screen with
            no actions still has its title in the same place as one that has them. */}
        <View style={local.spacer} />
        {right}
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
    // Holds the row open on the one screen with no title and no actions, so the
    // header never collapses to a bare band of colour.
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
  // Holds the mark and the title on one baseline. `flexShrink` is what keeps a
  // long name from pushing the actions off the trailing edge: the title gives up
  // width (and wraps to its second line) before the row overflows.
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  title: {
    // `fontSize` is animated in, so it is deliberately absent here.
    fontWeight: "700",
    color: colors.text,
    // Long titles wrap rather than push the row wider than the header.
    flexShrink: 1,
  },
});
