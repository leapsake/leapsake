import type { SearchHit } from "@leapsake/schema";
import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Link,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrowseTiles } from "../../components/BrowseTiles";
import { highlightBirthday, highlightMatch } from "../../lib/highlightMatch";
import { useCore } from "../../lib/core-context";
import { categoryFor, filterHits } from "../../lib/search-categories";
import { colors, radius, styles } from "../../lib/styles";

/**
 * Shortest query the screen acts on — mirrors the service's own floor so the
 * results clear the instant the term drops below it, rather than waiting for an
 * empty response. (Kept in sync with `MIN_QUERY_LENGTH` in `search-service`.)
 */
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

/**
 * The route a result opens, branching on its type. A gift idea has no read-only
 * view on either client, so its actionable page is the edit screen (the same
 * choice the tag page makes for its gift-idea rows).
 */
function pathFor(hit: SearchHit): string {
  if (hit.entityType === "tag") return `/tags/${hit.entityId}`;
  if (hit.entityType === "holiday") return `/holidays/${hit.entityId}`;
  if (hit.entityType === "gift_idea") return `/gifts/${hit.entityId}/edit`;
  if (hit.entityType === "pet") return `/pets/${hit.entityId}`;
  return `/people/${hit.entityId}`;
}

/**
 * Global search, ported from the desktop's chrome SearchBar to its own tab. A
 * debounced `core.search.query` feeds a results list; each hit shows its title
 * (matched run bolded) and, for non-name matches, a muted "matched on …" line.
 * Tapping a result navigates to the entity's (or tag's) page, pushed over the
 * tab bar on the root stack.
 *
 * **Arriving here does not raise the keyboard.** The field used to `autoFocus`,
 * which put the keyboard over the bottom two thirds of the screen before the
 * user had seen any of it — fine when there was nothing under the field, but this
 * screen now doubles as the browse surface for the catalogs that left the tab
 * bar, and a browse list under a keyboard is a browse list nobody finds. Focus is
 * therefore on demand: tap the field (free — that's what a `TextInput` does), or
 * tap the Search tab *again* while already here (below).
 *
 * ### The field is the title
 *
 * This is the only screen that runs with `headerShown: false`, so it owns its top
 * inset instead of inheriting one from `AppHeader`. A "Search…" field where the
 * word "Search" would otherwise be printed says it once instead of twice.
 *
 * That trade costs a `role="header"` landmark, so the field carries the screen's
 * name for assistive tech itself: an explicit `accessibilityLabel` (a placeholder
 * is not a label — it is dropped from the accessible name the moment the field
 * has a value) plus the search role, which is what makes VoiceOver say "Search,
 * search field". Arrival is still announced by the tab — "Search, tab, 2 of 4" —
 * which is the sentence a screen reader user actually hears on the way in.
 *
 * Nothing here opts into `useHeaderScroll`: there is no title left to collapse.
 *
 * ### Arriving already narrowed
 *
 * `?type=` opens the screen filtered to one category, which is how "find me a
 * person" is reachable from the People & Pets list without that list growing a
 * search field of its own — see `components/SearchHereLink.tsx`. The filter
 * therefore has exactly one representation, a URL, and it is also what the New
 * tab reads to know that a create action here is unambiguous.
 *
 * Tapping a browse tile does **not** set it: a tile is a way to the catalog it
 * names, not a way to narrow a search nobody has started. See `BrowseTiles`.
 *
 * Filtering happens **on the results**, not in the query: the service caps at 50
 * hits from an in-memory pass, so narrowing the answer is free, while narrowing
 * the question would mean a new core surface and a second place for the two
 * clients to disagree about what a "person result" is.
 */
export default function SearchScreen() {
  const core = useCore();
  const router = useRouter();
  const navigation = useNavigation();
  const inputRef = useRef<TextInput>(null);
  // From the context, never a constant: `DegradedFrame` (lib/core-context.tsx)
  // zeroes `top` when the custody banner has already consumed the notch. Same
  // reasoning as `AppHeader`, which is what used to apply this inset here.
  const insets = useSafeAreaInsets();

  const { type } = useLocalSearchParams<{ type?: string }>();
  const category = categoryFor(type);

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const shown = filterHits(results, category);

  /** Drop the narrowing an arrival brought with it — a `setParams` rather than a
   *  `setState`, since the filter lives in the URL rather than beside it. */
  const clearCategory = () => router.setParams({ type: undefined });

  // A second press of the Search tab focuses the field — the standard "tab
  // pressed while already on it" gesture (the same event other apps use to
  // scroll a list back to the top). `isFocused()` is what separates *arriving*
  // here from *already being* here: the event fires for both, and only the
  // latter should raise the keyboard.
  useEffect(() => {
    // The bottom-tab navigator emits `tabPress`, but it isn't in the generic
    // navigation event map expo-router exposes, and @react-navigation/bottom-tabs
    // is only a transitive dependency — so the event is narrowed here rather than
    // by importing that package's types.
    const tabs = navigation as unknown as {
      addListener(event: "tabPress", callback: () => void): () => void;
    };
    return tabs.addListener("tabPress", () => {
      if (navigation.isFocused()) inputRef.current?.focus();
    });
  }, [navigation]);

  // Latest-query-wins: query promises can resolve out of order, so a stale
  // response (token !== latest) is ignored rather than allowed to flicker in.
  const queryToken = useRef(0);

  useEffect(() => {
    // Below the floor (incl. empty): clear immediately, no in-flight hold.
    if (term.trim().length < MIN_QUERY_LENGTH) {
      queryToken.current++; // invalidate any in-flight response
      setResults([]);
      return;
    }
    const token = ++queryToken.current;
    const timer = setTimeout(() => {
      void core.search.query(term).then((hits) => {
        if (token !== queryToken.current) return; // a newer query superseded this
        setResults(hits);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [core, term]);

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: insets.top + 16,
          paddingLeft: insets.left + 16,
          paddingRight: insets.right + 16,
        },
      ]}
    >
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={term}
        onChangeText={setTerm}
        placeholder="Search…"
        placeholderTextColor={colors.muted}
        // The placeholder is what a sighted user reads and the label is what a
        // screen reader hears; both are needed, because the placeholder is gone
        // from the accessible name as soon as there is a value to read instead.
        accessibilityLabel="Search"
        accessibilityRole="search"
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />

      {/* The active narrowing, and the way out of it. Above the results rather
          than beside the field, so it reads as a statement about what is listed
          below it — which is exactly what it is. */}
      {category !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${category.label}. Search everything instead`}
          testID="search-filter-chip"
          style={local.chip}
          onPress={clearCategory}
        >
          <Text style={local.chipText}>
            {category.glyph} {category.label} ✕
          </Text>
        </Pressable>
      )}

      {/*
        An empty field browses instead of searching, so this screen answers
        "where is Holidays?" as well as "where is Ana?". Strictly the *empty*
        field — the moment anything is typed the results list takes over, so the
        one-character state stays blank and "No matches." still says exactly what
        it used to. Offering the browse grid under a failed search would read as
        "did you mean one of these", which it never is.
      */}
      {term.trim() === "" ? (
        category === undefined ? (
          <View style={local.browse}>
            <Text style={styles.muted}>
              Search people, pets, tags, holidays, and gift ideas.
            </Text>
            <BrowseTiles onPick={(picked) => router.push(picked.browseHref)} />
          </View>
        ) : (
          // Narrowed, but with nothing to narrow yet — an arrival from a
          // catalog's Search link. The prompt says what typing will do now, and
          // the link is the way back to the catalog that sent us, for a user who
          // came here and then decided they would rather scroll after all.
          <View style={local.browse}>
            <Text style={styles.muted}>
              Type to search {category.label.toLocaleLowerCase()}.
            </Text>
            <Link href={category.browseHref} style={styles.link}>
              See all {category.label.toLocaleLowerCase()}
            </Link>
          </View>
        )
      ) : (
        <FlatList
          data={shown}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(hit) => `${hit.entityType}:${hit.entityId}`}
          ListEmptyComponent={
            term.trim().length < MIN_QUERY_LENGTH ? null : (
              <Text style={styles.muted}>No matches.</Text>
            )
          }
          renderItem={({ item: hit }) => (
            <Pressable
              accessibilityRole="button"
              style={styles.row}
              onPress={() => router.push(pathFor(hit))}
            >
              <ResultRow hit={hit} term={term} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const local = StyleSheet.create({
  browse: {
    gap: 16,
  },
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.lg,
    backgroundColor: colors.accentTint,
  },
  chipText: {
    fontSize: 13,
    color: colors.accent,
  },
});

function ResultRow({ hit, term }: { hit: SearchHit; term: string }) {
  // The "name" facet is already shown by the title, so only the other facets
  // drive the "matched on …" subtitle.
  const reasons = hit.reasons.filter((r) => r.facet !== "name");
  return (
    <View>
      <Text style={[styles.rowText, { color: colors.accent }]}>
        {/* Tag results render with the "#" sigil; it's never part of the match,
            so it sits outside the highlighted run. */}
        {hit.entityType === "tag" && "#"}
        {highlightMatch(hit.title, term)}
      </Text>
      {reasons.length > 0 && (
        <Text style={[styles.fieldLabel, { marginTop: 2 }]}>
          matched on{" "}
          {reasons.map((r, ri) => (
            <Text key={`${r.facet}:${r.matchedText}`}>
              {ri > 0 && ", "}
              {r.facet === "tag" && "#"}
              {r.facet === "birthday"
                ? highlightBirthday(r.matchedText, term)
                : highlightMatch(
                    r.matchedText,
                    term,
                    r.facet === "phone"
                      ? "phone"
                      : r.facet === "address"
                        ? "address"
                        : "text",
                  )}
            </Text>
          ))}
        </Text>
      )}
    </View>
  );
}
