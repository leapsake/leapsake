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
import { SearchInput } from "../../components/SearchInput";
import { highlightBirthday, highlightMatch } from "../../lib/highlightMatch";
import { useCore } from "../../lib/core-context";
import {
  type SearchFacet,
  facetParam,
  facetPhrase,
  facetsFor,
  filterHits,
} from "../../lib/search-categories";
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
 * screen doubles as the browse surface for the catalogs that have no tab of
 * their own, and a browse list under a keyboard is a browse list nobody finds.
 * Focus is
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
 * The box itself is {@link SearchInput}, which is also the filter inside a
 * `SuggestField`'s sheet: it owns the 🔍 and the handling that goes with it, and
 * this screen keeps the searching.
 *
 * Nothing here opts into `useHeaderScroll`: there is no title left to collapse.
 *
 * ### Arriving already narrowed
 *
 * `?type=` opens the screen filtered, which is how "find me a person" is
 * reachable from the People & Pets list without that list growing a search field
 * of its own — see `components/SearchHereLink.tsx`. The filter therefore has
 * exactly one representation, a URL.
 *
 * It carries a **list** of record kinds, one chip each, each dropped on its own.
 * A catalog's 🔍 hands over everything that catalog holds, and People & Pets
 * holds two things: a user who came here to find a person can drop the pets and
 * keep searching, where a single "People & Pets" chip left them nothing to say
 * short of clearing the filter and getting the gifts and holidays back too. The
 * grid above still shows the catalog whole — see `lib/search-categories.ts` for
 * why a tile and a chip are different units.
 *
 * A filtered arrival offers **no create action**, which it briefly did: the New
 * tab read `?type=` to work out that "add" was unambiguous here. There is no
 * header on this screen to put a ➕ in, and the catalog the filter names is one
 * tap away below with a ➕ of its own — see `app/(tabs)/_layout.tsx`.
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
  const facets = facetsFor(type);

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const shown = filterHits(results, facets);

  /** Drop one chip, leaving the rest — a `setParams` rather than a `setState`,
   *  since the filter lives in the URL rather than beside it. Dropping the last
   *  one writes no param at all, which is an unfiltered search. */
  const dropFacet = (dropped: SearchFacet) =>
    router.setParams({
      type: facetParam(facets.filter((facet) => facet !== dropped)),
    });

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
      <SearchInput
        // Held here rather than left to the field because this screen focuses it
        // from outside the box — see the `tabPress` listener above.
        inputRef={inputRef}
        // For the E2E harness: an empty field carries no accessibility text, and
        // its label "Search" is a word the tab bar under it also uses.
        testID="search-field"
        value={term}
        onChangeText={setTerm}
        placeholder="Search…"
        // The placeholder is what a sighted user reads and the label is what a
        // screen reader hears; both are needed, because the placeholder is gone
        // from the accessible name as soon as there is a value to read instead.
        accessibilityLabel="Search"
        returnKeyType="search"
        autoCapitalize="none"
      />

      {/* The active narrowing, and the way out of it. Above the results rather
          than beside the field, so it reads as a statement about what is listed
          below it — which is exactly what it is. One chip per kind of record, so
          the way out is per kind too: the row is the sentence "people and pets",
          and a tap deletes a word from it rather than the whole sentence. */}
      {facets.length > 0 && (
        <View style={local.chips}>
          {facets.map((facet) => (
            <Pressable
              key={facet.type}
              accessibilityRole="button"
              // Says what tapping does, not what the chip is: the glyph and label
              // are already read, and "✕" on its own is not an instruction.
              accessibilityLabel={`${facet.label}. Remove this filter`}
              testID={`search-filter-chip-${facet.type}`}
              style={local.chip}
              onPress={() => dropFacet(facet)}
            >
              <Text style={local.chipText}>
                {facet.glyph} {facet.label} ✕
              </Text>
            </Pressable>
          ))}
        </View>
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
        facets.length === 0 ? (
          // No prose over the tiles: they name the same four things a sentence
          // listing them would, and the field's own placeholder has already said
          // the word "Search".
          <BrowseTiles onPick={(picked) => router.push(picked.browseHref)} />
        ) : (
          // Narrowed, but with nothing to narrow yet — an arrival from a
          // catalog's Search link. The prompt says what typing will do now, and
          // the link is the way back to the catalog that sent us, for a user who
          // came here and then decided they would rather scroll after all.
          <View style={local.browse}>
            <Text style={styles.muted}>
              Type to search {facetPhrase(facets)}.
            </Text>
            {/* Every facet still selected came from one catalog's 🔍, so the
                first one names the list to go back to — pets are listed in
                People & Pets, which is the list this link opens for either. */}
            <Link href={facets[0].browseHref} style={styles.link}>
              See all {facetPhrase(facets)}
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
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
