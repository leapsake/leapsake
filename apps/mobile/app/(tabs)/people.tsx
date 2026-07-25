import { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import type { CoreApi, EntityRow } from "@leapsake/core";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { colors, styles } from "../../lib/styles";

// The combined "People & Pets" list, ported from desktop's EntityList. People
// and pets share one alphabetical list, and both row types navigate to their
// own detail page. The muted "(pet)" suffix keeps the two entity types visually
// distinguishable in the shared list. This screen's title and "Add" actions live
// on the tab navigator (app/(tabs)/_layout.tsx), which owns this tab's header.
//
// The duplicates link is **conditional on there being duplicates** and states
// the count. It used to head this list permanently, advertising a chore even on
// a fresh install with nobody in it; detection is a cheap in-memory pass, so the
// header can just tell the truth. See the desktop EntityList mirror.
//
// `?pick=self` puts the screen in **pick-yourself** mode, which is where the
// "🙋 Which of these is you?" onboarding nudge lands (app/(tabs)/index.tsx maps
// it here): each Person row grows a "This is me" action that sets the
// self-person. Pets can't be you, so they offer
// nothing in that mode. The picked person keeps a "(You)" badge afterwards — the
// readback that the pick landed, in either mode.
export default function PeoplePetsScreen() {
  const core = useCore();
  const { pick } = useLocalSearchParams<{ pick?: string }>();
  const picking = pick === "self";

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
  const { data, error, reload } = useFocusedData(load);
  const [entities, self, duplicateCount] = data ?? [null, undefined, 0];

  return (
    <View style={styles.screen}>
      {error !== null ? (
        <Text style={styles.danger}>{error}</Text>
      ) : entities === null ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={entities}
          keyExtractor={(entity) => `${entity.type}:${entity.id}`}
          ListHeaderComponent={
            picking ? (
              <Text style={[styles.row, styles.muted]}>
                Which of these is you? Pick yourself from the list.
              </Text>
            ) : duplicateCount > 0 ? (
              <Link href="/duplicates" style={[styles.row, styles.link]}>
                Review {duplicateCount} possible{" "}
                {duplicateCount === 1 ? "duplicate" : "duplicates"}
              </Link>
            ) : null
          }
          ListEmptyComponent={
            <Text style={styles.muted}>Nobody here yet.</Text>
          }
          renderItem={({ item }) => (
            <EntityListRow
              entity={item}
              isSelf={item.type === "person" && item.id === self?.personId}
              picking={picking}
              onReload={reload}
            />
          )}
        />
      )}
    </View>
  );
}

/**
 * Set the self-person, then leave pick mode so the list goes back to ordinary
 * navigation. `reload` refreshes in place (nothing navigates here, so no refocus
 * would fire on its own) and the badge appears on the picked row.
 */
async function pickSelf(
  core: CoreApi,
  personId: string,
  reload: () => Promise<void>,
  leavePickMode: () => void,
): Promise<void> {
  try {
    await core.self.set(personId);
    await reload();
    leavePickMode();
  } catch (e) {
    Alert.alert("Couldn't set", String(e));
  }
}

function EntityListRow({
  entity,
  isSelf,
  picking,
  onReload,
}: {
  entity: EntityRow;
  isSelf: boolean;
  picking: boolean;
  onReload: () => Promise<void>;
}) {
  const core = useCore();
  const router = useRouter();

  if (entity.type === "person") {
    const label = (
      <Text style={[styles.rowText, { color: colors.accent }]}>
        {entity.label} {isSelf && <Text style={styles.muted}>(You)</Text>}
      </Text>
    );
    // Outside pick mode the whole row stays one tap target, as it always has.
    if (!picking) {
      return (
        <Link href={`/people/${entity.id}`} style={styles.row}>
          {label}
        </Link>
      );
    }
    return (
      <View style={[styles.row, styles.rowMeta, { marginTop: 0 }]}>
        <Link href={`/people/${entity.id}`}>{label}</Link>
        {/* Only a Person can be you, and there's no point offering it on the
            row that already is. */}
        {!isSelf && (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void pickSelf(core, entity.id, onReload, () =>
                router.replace("/(tabs)/people"),
              )
            }
          >
            <Text style={styles.link}>This is me</Text>
          </Pressable>
        )}
      </View>
    );
  }
  return (
    <Link href={`/pets/${entity.id}`} style={styles.row}>
      <Text style={[styles.rowText, { color: colors.accent }]}>
        {entity.label} <Text style={styles.muted}>(pet)</Text>
      </Text>
    </Link>
  );
}
