import { type Gender, genderLabel } from "@leapsake/schema";
import { SelectField } from "./SelectField";

// The gender values in the same order the desktop <select> shows them, with a
// leading "unset" (null) option.
const options: { value: Gender | null; label: string }[] = [
  { value: null, label: "—" },
  { value: "female", label: genderLabel.female },
  { value: "male", label: genderLabel.male },
  { value: "nonbinary", label: genderLabel.nonbinary },
];

export function GenderField({
  label,
  value,
  onChange,
}: {
  /** Passed through to {@link SelectField}. */
  label: string;
  value: Gender | null;
  onChange: (value: Gender | null) => void;
}) {
  return (
    <SelectField
      label={label}
      value={value}
      options={options}
      onChange={onChange}
    />
  );
}
