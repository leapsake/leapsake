import type { EntityType } from "@leapsake/schema";
import { SegmentedControl } from "./SegmentedControl";

/** Person or Pet, as a {@link SegmentedControl} heading the create form. */
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
