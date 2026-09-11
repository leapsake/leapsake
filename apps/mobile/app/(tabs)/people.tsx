import { useCallback } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { Link } from "expo-router";
import type { EntityRow } from "@leapsake/core";
import { EmptyState } from "../../components/EmptyState";
import { useCore } from "../../lib/core-context";
import { entityRowHref } from "../../lib/record-title";
import { useFocusedData } from "../../lib/useFocusedData";
import { useHeaderScroll } from "../../lib/use-header-scroll";
import { colors, styles } from "../../lib/styles";

// The combined "People & Pets" list, ported from desktop's EntityList. People
// and pets share one alphabetical list, and both row types navigate to their
// own detail page. The muted "(pet)" suffix keeps the two entity types visually
// distinguishable in the shared list.
//
// **A tab.** It briefly wasn't: the bar was rebuilt around what you *do* (Home,
// Search, New, Account) and this screen became a hidden member of the tab
// navigator, reachable through Search's browse tiles on the theory that a
// catalog is somewhere you go looking for a particular record. In use that made
// the app's biggest list — and the thing it is mostly about — a two-tap trip,
// which is a lot to charge for the seat a create button was sitting in. The seat
// is People's again and creating moved to this screen's own corner.
//
// Its title ("People & Pets", where the bar's label is just "People") and its
// header actions are declared with the rest of the bar in
// `app/(tabs)/_layout.tsx`: 🔍 into a search already narrowed to people and
// pets, and ➕ to `/add`. Rows still push their person or pet onto the root
// stack, over the bar and with a Back.
//
// The duplicates link is **conditional on there being duplicates** and states
// the count. It used to head this list permanently, advertising a chore even on
// a fresh install with nobody in it; detection is a cheap in-memory pass, so the
// header can just tell the truth. See the desktop EntityList mirror.
//
// The self-person shows a "(You)" badge on their row, and that is all this
// screen has to do with them now. It used to carry a `?pick=self` mode as well —
// each Person row growing a "This is me" action — which was where the
// self-person nudge landed and the only reason a row here was ever two tap
// targets instead of one. That mode could only ask *which of these is you?*, so
// it could only be asked once somebody was already in the app; `/about-you`
// answers the question from either end and took both entrances with it.
export default function PeoplePetsScreen() {
  const core = useCore();

  const load = useCallback(
    () =>
      Promise.all([
        core.views.entityList(),
        core.self.get(),
        // Gates the review link below: offered only when there is something to
        // review, and it states the count when there is.
        core.duplicates.count(),
      ]),
    [core],
  );
  const { data, error } = useFocusedData(load);
  const scrollProps = useHeaderScroll();
  const [entities, self, duplicateCount] = data ?? [null, undefined, 0];

  return (
    <View style={styles.screen}>
      {error !== null ? (
        <Text style={styles.danger}>{error}</Text>
      ) : entities === null ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          {...scrollProps}
          // Grown so an empty list can centre its message and its two ways in;
          // the padding around the rows is the screen's, not the list's.
          contentContainerStyle={styles.listContent}
          data={entities}
          keyExtractor={(entity) => `${entity.type}:${entity.id}`}
          ListHeaderComponent={
            duplicateCount > 0 ? (
              <Link href="/duplicates" style={[styles.row, styles.link]}>
                Review {duplicateCount} possible{" "}
                {duplicateCount === 1 ? "duplicate" : "duplicates"}
              </Link>
            ) : null
          }
          ListEmptyComponent={
            // Both ways in, not just the one the header offers: typing someone
            // in, and lifting the address book that's already on the phone.
            // Import is the bigger win on a first run and has no header action
            // of its own here (it's a link at the foot of the Add form), so an
            // empty list is the one place it gets top billing.
            <EmptyState
              message="Nobody here yet."
              actions={[
                { href: "/add", label: "+ Add a person or pet" },
                { href: "/import", label: "Import from your contacts" },
              ]}
            />
          }
          renderItem={({ item }) => (
            <EntityListRow
              entity={item}
              isSelf={item.type === "person" && item.id === self?.personId}
            />
          )}
        />
      )}
    </View>
  );
}

/** One row: a person or a pet, each one link to its own page and nothing else.
 *  The self-person wears a "(You)" badge — the readback that the pick landed. */
function EntityListRow({
  entity,
  isSelf,
}: {
  entity: EntityRow;
  isSelf: boolean;
}) {
  if (entity.type === "person") {
    return (
      <Link href={entityRowHref(entity)} style={styles.row}>
        <Text style={[styles.rowText, { color: colors.accent }]}>
          {entity.label} {isSelf && <Text style={styles.muted}>(You)</Text>}
        </Text>
      </Link>
    );
  }
  return (
    <Link href={entityRowHref(entity)} style={styles.row}>
      <Text style={[styles.rowText, { color: colors.accent }]}>
        {entity.label} <Text style={styles.muted}>(pet)</Text>
      </Text>
    </Link>
  );
}
