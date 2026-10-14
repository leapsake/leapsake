import { useCallback } from "react";
import { Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { CoreApi } from "@leapsake/core";
import { entityLabel } from "@leapsake/schema";
import { type PartyOption, partyKey } from "@leapsake/ui/headless";
import { GiftCaptureForm } from "../../components/GiftCaptureForm";
import { useCore } from "../../lib/core-context";
import { useFocusedData } from "../../lib/useFocusedData";
import { styles } from "../../lib/styles";
import { LoadState } from "../../components/LoadState";
import { FormScrollView } from "../../components/FormScrollView";

/** The person or pet being added, whom no list offers, by their party key. */
async function draftRecipient(
  core: CoreApi,
  key: string | undefined,
): Promise<PartyOption | undefined> {
  const [type, id] = key?.split(":") ?? [];
  if (id === undefined || (type !== "person" && type !== "pet")) return;
  const entity =
    type === "person" ? await core.people.get(id) : await core.pets.get(id);
  return entity && { type, id, label: entityLabel(type, entity) };
}

/**
 * Add a gift. `?recipient=` fixes who it is for, and saving goes back there;
 * `?given=1` ticks it as already given; `?url=` or `?title=` start the gift.
 */
export default function GiftCreateScreen() {
  const core = useCore();
  const router = useRouter();
  const { recipient, given, url, title } = useLocalSearchParams<{
    recipient?: string;
    given?: string;
    url?: string;
    title?: string;
  }>();

  const load = useCallback(
    () =>
      Promise.all([
        core.gifts.ideas.list(),
        core.views.entityList(),
        draftRecipient(core, recipient),
      ]),
    [core, recipient],
  );
  const { data, error } = useFocusedData(load);

  // The form declares the header itself; two `Stack.Screen`s would race.
  if (error !== null || data === null) {
    return <LoadState error={error} header={{ title: "Add a gift" }} />;
  }

  const [ideas, entities, draft] = data;
  const candidates: PartyOption[] = entities.map((e) => ({
    type: e.type,
    id: e.id,
    label: e.label,
  }));
  const fixedRecipient =
    recipient === undefined
      ? undefined
      : (candidates.find((c) => partyKey(c) === recipient) ?? draft);

  return (
    <FormScrollView contentContainerStyle={styles.screen}>
      {fixedRecipient !== undefined &&
        fixedRecipient.label !== "" && (
          // The only mention of the recipient, the picker being hidden.
          <Text style={styles.muted}>A gift for {fixedRecipient.label}.</Text>
        )}

      <GiftCaptureForm
        title="Add a gift"
        ideaPool={ideas}
        fixedRecipient={fixedRecipient}
        recipientCandidates={
          fixedRecipient === undefined ? candidates : undefined
        }
        startGiven={given === "1"}
        startUrl={url}
        startTitle={title}
        onSaved={() =>
          fixedRecipient === undefined
            ? router.dismissTo("/gifts")
            : router.back()
        }
      />
    </FormScrollView>
  );
}
