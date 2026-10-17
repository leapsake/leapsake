import { Text } from "react-native";
import {
  type CountryOption,
  RELIGIONS,
  type Religion,
  contactCountryOptions,
  countryFlag,
  countryName,
} from "@leapsake/schema";
import { useMessages } from "@leapsake/ui/messages";
import { MultiPickField } from "./MultiPickField";
import { styles } from "../lib/styles";

/** A person's nationalities and religions, each a set picked from a list. */
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

  return (
    <>
      <MultiPickField<CountryOption>
        label={m.affiliations.nationalities}
        chosen={nationalities.map((code) => ({
          code,
          name: countryName(code),
        }))}
        options={contactCountryOptions}
        onChange={(chosen) => onNationalitiesChange(chosen.map((c) => c.code))}
        getKey={(c) => c.code}
        getLabel={(c) => c.name}
        renderLabel={(c) => (
          <Text style={styles.rowText}>
            {countryFlag(c.code)} {c.name}
          </Text>
        )}
        testID="person-nationalities"
      />
      <MultiPickField<Religion>
        label={m.affiliations.religions}
        chosen={religions}
        options={RELIGIONS}
        onChange={onReligionsChange}
        getKey={(r) => r}
        getLabel={(r) => m.affiliations.religion[r]}
        minChars={0}
        testID="person-religions"
      />
    </>
  );
}
