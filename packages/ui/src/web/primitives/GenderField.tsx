import type { Gender } from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";

/**
 * The Gender picker shared by the People & Pets create/edit forms. A plain
 * `<select name="gender">` whose empty option means “unset” — the host's write
 * path parses `""` back to null. `defaultValue` preselects the stored value on
 * edit.
 *
 * Uncontrolled on purpose: the value is read from the submitted form rather
 * than held in React state, which is what lets the field work with no
 * JavaScript at all.
 */
export function GenderField({ value }: { value?: Gender | null }) {
  const m = useMessages();

  return (
    <label>
      {m.gender.fieldLabel}{" "}
      <select name="gender" defaultValue={value ?? ""}>
        <option value="">{m.common.none}</option>
        <option value="female">{m.gender.female}</option>
        <option value="male">{m.gender.male}</option>
        <option value="nonbinary">{m.gender.nonbinary}</option>
      </select>
    </label>
  );
}
