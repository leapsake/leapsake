import { Text } from "react-native";
import { contactCountryOptions, countryFlag } from "@leapsake/schema";
import { Typeahead } from "./Typeahead";
import { styles } from "../lib/styles";

/** A country option as the shared {@link Typeahead} carries it. */
type CountryOption = { code: string; name: string };

/**
 * The mobile stand-in for desktop's 183-country `<select>` — a thin
 * {@link Typeahead} over `contactCountryOptions`, keyed by ISO alpha-2 code. The
 * field is optional (`clearable`), and out-of-list codes (e.g. from a future
 * import) are preserved on display, falling back to the raw code, mirroring the
 * desktop select appending an unknown current value.
 *
 * The value is the ISO alpha-2 code (already uppercase in the option list), or
 * `null` when unset; the schema's `countryCodeSchema` accepts it as-is.
 */
export function CountryField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const selected: CountryOption | null =
    value === null
      ? null
      : (contactCountryOptions.find((c) => c.code === value) ?? {
          code: value,
          name: value,
        });

  return (
    <Typeahead<CountryOption>
      label="Country"
      value={selected}
      options={contactCountryOptions}
      onChange={(option) => onChange(option?.code ?? null)}
      getKey={(c) => c.code}
      getLabel={(c) => c.name}
      renderValue={(c) => (
        <Text style={styles.fieldValue}>
          {countryFlag(c.code)} {c.name}
        </Text>
      )}
      renderOption={(c) => (
        <Text style={styles.rowText}>
          {countryFlag(c.code)} {c.name}
        </Text>
      )}
      placeholder="Start typing a country"
      clearable
    />
  );
}
