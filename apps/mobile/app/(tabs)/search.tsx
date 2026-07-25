import type { SearchHit } from "@leapsake/schema";
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { highlightBirthday, highlightMatch } from "../../lib/highlightMatch";
import { useCore } from "../../lib/core-context";
import { colors, styles } from "../../lib/styles";

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
 */
export default function SearchScreen() {
  const core = useCore();
  const router = useRouter();

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);

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
    <View style={styles.screen}>
      <TextInput
        style={styles.input}
        value={term}
        onChangeText={setTerm}
        placeholder="Search people, pets, tags, holidays, and gift ideas"
        placeholderTextColor={colors.muted}
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />

      <FlatList
        data={results}
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
    </View>
  );
}

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
