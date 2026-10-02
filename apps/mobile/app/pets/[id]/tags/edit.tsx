import { useCallback } from "react";
import { useLocalSearchParams } from "expo-router";
import { TAGS_TITLE, TagsEditForm } from "../../../../components/TagsEditForm";
import { useCore } from "../../../../lib/core-context";
import { useFocusedData } from "../../../../lib/useFocusedData";
import { LoadState } from "../../../../components/LoadState";

/** A pet's tags — see `app/people/[id]/tags/edit.tsx`, which this mirrors. */
export default function PetTagsEditScreen() {
  const core = useCore();
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(
    async () => ({ view: await core.views.pet(id) }),
    [core, id],
  );
  const { data, error } = useFocusedData(load);

  if (error !== null || data === null || data.view === null) {
    return (
      <LoadState
        error={error}
        loading={data === null}
        missing="Pet not found."
        header={{ title: TAGS_TITLE }}
      />
    );
  }

  return <TagsEditForm type="pet" id={id} tags={data.view.tags} />;
}
