import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { RowMenu, rowMenuItem } from "./RowMenu";
import { Typeahead } from "./Typeahead";
import { styles } from "../lib/styles";

/**
 * Several picks from one list: a typeahead that stays open to add more, and
 * each chosen one as a row with Remove in its ⋯.
 */
export function MultiPickField<T>({
  label,
  chosen,
  options,
  onChange,
  getKey,
  getLabel,
  renderLabel,
  minChars,
  testID,
}: {
  label: string;
  chosen: readonly T[];
  options: readonly T[];
  onChange: (chosen: T[]) => void;
  getKey: (option: T) => string;
  getLabel: (option: T) => string;
  /** How a row draws its option, when plain words aren't enough. */
  renderLabel?: (option: T) => ReactNode;
  minChars?: number;
  testID?: string;
}) {
  const keys = new Set(chosen.map(getKey));

  return (
    <View style={styles.field}>
      <Typeahead
        multi
        label={label}
        value={null}
        options={options}
        exclude={keys}
        onChange={(option) => option !== null && onChange([...chosen, option])}
        getKey={getKey}
        getLabel={getLabel}
        renderOption={renderLabel}
        minChars={minChars}
        testID={testID}
      />
      {chosen.map((option) => (
        <View key={getKey(option)} style={[styles.row, styles.sectionHeader]}>
          {renderLabel ? (
            renderLabel(option)
          ) : (
            <Text style={styles.rowText}>{getLabel(option)}</Text>
          )}
          <RowMenu
            subject={getLabel(option)}
            items={[
              rowMenuItem.remove(() =>
                onChange(chosen.filter((c) => getKey(c) !== getKey(option))),
              ),
            ]}
          />
        </View>
      ))}
    </View>
  );
}
