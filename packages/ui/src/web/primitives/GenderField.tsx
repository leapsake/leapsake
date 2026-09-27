import type { Gender } from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";

/**
 * The Gender picker shared by the People & Pets forms: a `<select name="gender">`
 * whose empty option means “unset”, which the write path reads back as null.
 */
export function GenderField({
  value,
  onChange,
}: {
  value: Gender | null;
  onChange: (gender: Gender | null) => void;
}) {
  const m = useMessages();

  return (
    <label>
      {m.gender.fieldLabel}{" "}
      <select
        name="gender"
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? null : (e.target.value as Gender))
        }
      >
        <option value="">{m.common.none}</option>
        <option value="female">{m.gender.female}</option>
        <option value="male">{m.gender.male}</option>
        <option value="nonbinary">{m.gender.nonbinary}</option>
      </select>
    </label>
  );
}
