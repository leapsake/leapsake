import { type Gender, genderLabel } from "@leapsake/schema";

/**
 * The Gender picker shared by the People & Pets create/edit forms. A plain
 * `<select name="gender">` whose empty option means "unset" (the router parses
 * `""` back to null). `defaultValue` preselects the stored value on edit.
 */
export function GenderField({ value }: { value?: Gender | null }) {
  return (
    <label>
      Gender{" "}
      <select name="gender" defaultValue={value ?? ""}>
        <option value="">—</option>
        <option value="female">{genderLabel.female}</option>
        <option value="male">{genderLabel.male}</option>
        <option value="nonbinary">{genderLabel.nonbinary}</option>
      </select>
    </label>
  );
}
