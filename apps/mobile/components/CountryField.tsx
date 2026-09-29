import { Text } from "react-native";
import { contactCountryOptions, countryFlag } from "@leapsake/schema";
import { Typeahead } from "./Typeahead";
import { styles } from "../lib/styles";

/** A country option as the shared {@link Typeahead} carries it. */
type CountryOption = { code: string; name: string };

/**
 * An optional country as its ISO alpha-2 code, or `null`. A code outside the
 * list still displays, as the raw code.
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
      clearable
    />
  );
}
