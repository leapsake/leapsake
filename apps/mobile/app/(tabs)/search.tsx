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
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrowseTiles } from "../../components/BrowseTiles";
import { SearchInput } from "../../components/SearchInput";
import { highlightBirthday, highlightMatch } from "../../lib/highlightMatch";
import { useCore } from "../../lib/core-context";
import { searchHitHref } from "../../lib/record-title";
import {
  type SearchFacet,
  facetParam,
  facetsFor,
  filterHits,
} from "../../lib/search-categories";
import { colors, radius, styles } from "../../lib/styles";

const TEXT = {
  matchedOn: "matched on",
  reasonSeparator: ", ",
};

/** The search service's own floor, so results clear without a round trip. */
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;

/**
 * Search, with no header: the field is the title. `?type=` arrives narrowed,
 * and arriving never raises the keyboard, since an empty field browses.
 */
export default function SearchScreen() {
  const core = useCore();
  const router = useRouter();
  const navigation = useNavigation();
  const inputRef = useRef<TextInput>(null);
  // From the context: `DegradedFrame` zeroes `top` under its banner.
  const insets = useSafeAreaInsets();

  const { type } = useLocalSearchParams<{ type?: string }>();
  const facets = facetsFor(type);

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const shown = filterHits(results, facets);

  /** Drop one chip; the filter lives in the URL, so this sets params. */
  const dropFacet = (dropped: SearchFacet) =>
    router.setParams({
      type: facetParam(facets.filter((facet) => facet !== dropped)),
    });

  // A second press of the Search tab focuses the field. `isFocused()` tells
  // it from arriving, which fires the same event.
  useEffect(() => {
    // `tabPress` is not in expo-router's event map, and bottom-tabs is only
    // a transitive dependency, so it is narrowed here.
    const tabs = navigation as unknown as {
      addListener(event: "tabPress", callback: () => void): () => void;
    };
    return tabs.addListener("tabPress", () => {
      if (navigation.isFocused()) inputRef.current?.focus();
    });
  }, [navigation]);

  // Latest query wins: a response that resolves out of order is ignored.
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
        // Held here because the `tabPress` listener focuses it.
        inputRef={inputRef}
        // For the E2E flows: an empty field has no accessibility text, and
        // its label "Search" is a word the tab bar under it also uses.
        testID="search-field"
        value={term}
        onChangeText={setTerm}
        placeholder="Search…"
        // A placeholder leaves the accessible name once there is a value.
        accessibilityLabel="Search"
        returnKeyType="search"
        autoCapitalize="none"
      />

      {/* The active narrowing, one chip per kind, each dropped on its own. */}
      {facets.length > 0 && (
        <View style={local.chips}>
          {facets.map((facet) => (
            <Pressable
              key={facet.type}
              accessibilityRole="button"
              // Says what tapping does: "✕" on its own is no instruction.
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

      {/* Only an empty field browses; under a failed search the grid would
          read as "did you mean one of these". */}
      {term.trim() === "" ? (
        // A narrowed arrival shows nothing under its chips.
        facets.length === 0 ? (
          <BrowseTiles onPick={(picked) => router.push(picked.browseHref)} />
        ) : null
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
              onPress={() => router.push(searchHitHref(hit))}
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
  // The title already shows a name match.
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
          {TEXT.matchedOn}{" "}
          {reasons.map((r, ri) => (
            <Text key={`${r.facet}:${r.matchedText}`}>
              {ri > 0 && TEXT.reasonSeparator}
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
