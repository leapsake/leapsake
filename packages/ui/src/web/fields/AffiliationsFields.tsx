import {
  RELIGIONS,
  type Religion,
  contactCountryOptions,
} from "@leapsake/schema";
import { useMessages } from "../../messages/index.js";

/**
 * A person's nationalities, as a multi-select of countries, and religions, a
 * checkbox each. Each posts every chosen value under its own name.
 */
export function AffiliationsFields({
  nationalities,
  religions,
  onNationalitiesChange,
  onReligionsChange,
}: {
  nationalities: readonly string[];
  religions: readonly Religion[];
  onNationalitiesChange: (codes: string[]) => void;
  onReligionsChange: (religions: Religion[]) => void;
}) {
  const m = useMessages();

  function toggle(religion: Religion, on: boolean) {
    onReligionsChange(
      on ? [...religions, religion] : religions.filter((r) => r !== religion),
    );
  }

  return (
    <>
      <label>
        {m.affiliations.nationalities}{" "}
        <select
          name="nationalities"
          multiple
          size={6}
          value={[...nationalities]}
          onChange={(e) =>
            onNationalitiesChange(
              [...e.target.selectedOptions].map((o) => o.value),
            )
          }
        >
          {contactCountryOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>{" "}
        <small>{m.affiliations.nationalitiesHint}</small>
      </label>
      <fieldset>
        <legend>{m.affiliations.religions}</legend>
        {RELIGIONS.map((religion) => (
          <label key={religion}>
            <input
              type="checkbox"
              name="religions"
              value={religion}
              checked={religions.includes(religion)}
              onChange={(e) => toggle(religion, e.target.checked)}
            />{" "}
            {m.affiliations.religion[religion]}
          </label>
        ))}
      </fieldset>
    </>
  );
}
