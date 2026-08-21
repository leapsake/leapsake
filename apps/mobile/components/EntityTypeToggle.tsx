import type { EntityType } from "@leapsake/schema";
import { SegmentedControl } from "./SegmentedControl";

/**
 * Person / Pet, as a two-segment pill — the head of the combined create form
 * (app/add.tsx), which replaced the chooser screen that used to ask the same
 * question with two full-width buttons. The pill itself is
 * {@link SegmentedControl}, which this drew first and the gift capture form's
 * Idea / Already gave it now shares.
 */
export function EntityTypeToggle({
  value,
  onChange,
}: {
  value: EntityType;
  onChange: (value: EntityType) => void;
}) {
  return (
    <SegmentedControl
      options={[
        { value: "person", label: "Person" },
        { value: "pet", label: "Pet" },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}
